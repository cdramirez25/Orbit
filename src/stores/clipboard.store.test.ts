import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { emitLocal } from '@/ipc/events';
import { useClipboardStore } from '@/stores/clipboard.store';
import type { ClipboardEntry } from '@/types';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getClipboardHistory: vi.fn(),
    copyClipboardEntry: vi.fn(),
    deleteClipboardEntry: vi.fn(),
    clearClipboardHistory: vi.fn(),
    clipboardAi: vi.fn(),
    copyClipboardText: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

function entry(id: number): ClipboardEntry {
  return {
    id,
    kind: 'text',
    copiedAtMs: id * 1000,
    text: `item ${id}`,
    charCount: 6,
    width: null,
    height: null,
    thumbnail: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useClipboardStore.setState({
    entries: [],
    copiedId: null,
    aiResult: null,
    aiResultCopied: false,
  });
  mocked.getClipboardHistory.mockResolvedValue([entry(2), entry(1)]);
  mocked.copyClipboardEntry.mockResolvedValue();
  mocked.deleteClipboardEntry.mockResolvedValue();
  mocked.clearClipboardHistory.mockResolvedValue();
  mocked.copyClipboardText.mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('clipboard.store', () => {
  it('refresh carga el historial', async () => {
    await useClipboardStore.getState().refresh();
    expect(useClipboardStore.getState().entries.map((e) => e.id)).toEqual([2, 1]);
  });

  it('si el historial no se puede pedir, conserva lo que había', async () => {
    useClipboardStore.setState({ entries: [entry(9)] });
    mocked.getClipboardHistory.mockRejectedValue(new Error('boom'));
    await useClipboardStore.getState().refresh();
    expect(useClipboardStore.getState().entries.map((e) => e.id)).toEqual([9]);
  });

  it('copy avisa "Copiado" y el aviso desaparece solo', async () => {
    await useClipboardStore.getState().copy(1);
    expect(mocked.copyClipboardEntry).toHaveBeenCalledWith(1);
    expect(useClipboardStore.getState().copiedId).toBe(1);

    vi.advanceTimersByTime(2000);
    expect(useClipboardStore.getState().copiedId).toBeNull();
  });

  it('si copiar falla no se muestra "Copiado"', async () => {
    mocked.copyClipboardEntry.mockRejectedValue(new Error('boom'));
    await useClipboardStore.getState().copy(1);
    expect(useClipboardStore.getState().copiedId).toBeNull();
  });

  it('remove quita el elemento al instante y avisa a Rust', async () => {
    useClipboardStore.setState({ entries: [entry(2), entry(1)] });
    const pending = useClipboardStore.getState().remove(2);
    expect(useClipboardStore.getState().entries.map((e) => e.id)).toEqual([1]);
    await pending;
    expect(mocked.deleteClipboardEntry).toHaveBeenCalledWith(2);
  });

  it('si borrar falla, vuelve a lo real', async () => {
    useClipboardStore.setState({ entries: [entry(2), entry(1)] });
    mocked.deleteClipboardEntry.mockRejectedValue(new Error('boom'));
    await useClipboardStore.getState().remove(2);
    expect(useClipboardStore.getState().entries.map((e) => e.id)).toEqual([2, 1]);
  });

  it('clear vacía el historial', async () => {
    useClipboardStore.setState({ entries: [entry(2), entry(1)], copiedId: 2 });
    await useClipboardStore.getState().clear();
    expect(mocked.clearClipboardHistory).toHaveBeenCalledTimes(1);
    expect(useClipboardStore.getState().entries).toEqual([]);
    expect(useClipboardStore.getState().copiedId).toBeNull();
  });

  describe('acciones de IA', () => {
    it('askAi muestra "trabajando" y luego el resultado', async () => {
      let finish: (text: string) => void = () => {};
      mocked.clipboardAi.mockImplementation(() => new Promise((resolve) => (finish = resolve)));

      const pending = useClipboardStore.getState().askAi(2, 'translate', 'es');
      expect(useClipboardStore.getState().aiResult).toEqual({
        id: 2,
        action: 'translate',
        status: 'working',
        text: '',
        errorCode: null,
      });
      expect(mocked.clipboardAi).toHaveBeenCalledWith(2, 'translate', 'es');

      finish('Hola');
      await pending;
      expect(useClipboardStore.getState().aiResult).toMatchObject({
        status: 'done',
        text: 'Hola',
      });
    });

    it('un fallo de la IA guarda su código', async () => {
      mocked.clipboardAi.mockRejectedValue({ code: 'ai.notConfigured', message: 'x' });
      await useClipboardStore.getState().askAi(2, 'summarize', 'en');
      expect(useClipboardStore.getState().aiResult).toMatchObject({
        status: 'error',
        errorCode: 'ai.notConfigured',
      });
    });

    it('un error sin código se guarda como desconocido', async () => {
      mocked.clipboardAi.mockRejectedValue(new Error('x'));
      await useClipboardStore.getState().askAi(2, 'explain', 'es');
      expect(useClipboardStore.getState().aiResult?.errorCode).toBe('unknown');
    });

    it('una respuesta que llega tarde de una petición anterior se descarta', async () => {
      const finishers: Array<(text: string) => void> = [];
      mocked.clipboardAi.mockImplementation(
        () => new Promise((resolve) => finishers.push(resolve)),
      );

      const first = useClipboardStore.getState().askAi(2, 'translate', 'es');
      const second = useClipboardStore.getState().askAi(1, 'summarize', 'es');
      finishers[1]?.('resumen');
      await second;
      finishers[0]?.('traducción vieja');
      await first;

      expect(useClipboardStore.getState().aiResult).toMatchObject({
        id: 1,
        action: 'summarize',
        text: 'resumen',
      });
    });

    it('cerrar el resultado lo quita y descarta lo que todavía venga en camino', async () => {
      let finish: (text: string) => void = () => {};
      mocked.clipboardAi.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
      const pending = useClipboardStore.getState().askAi(2, 'translate', 'es');

      useClipboardStore.getState().closeAiResult();
      finish('tarde');
      await pending;

      expect(useClipboardStore.getState().aiResult).toBeNull();
    });

    it('copiar el resultado lo manda al portapapeles y avisa "Copiado" un momento', async () => {
      mocked.clipboardAi.mockResolvedValue('Hola');
      await useClipboardStore.getState().askAi(2, 'translate', 'es');

      await useClipboardStore.getState().copyAiResult();
      expect(mocked.copyClipboardText).toHaveBeenCalledWith('Hola');
      expect(useClipboardStore.getState().aiResultCopied).toBe(true);

      vi.advanceTimersByTime(2000);
      expect(useClipboardStore.getState().aiResultCopied).toBe(false);
    });

    it('no se copia un resultado que todavía no llegó ni uno vacío, ni se avisa si falla', async () => {
      useClipboardStore.setState({
        aiResult: { id: 2, action: 'translate', status: 'working', text: '', errorCode: null },
      });
      await useClipboardStore.getState().copyAiResult();
      useClipboardStore.setState({
        aiResult: { id: 2, action: 'translate', status: 'done', text: '', errorCode: null },
      });
      await useClipboardStore.getState().copyAiResult();
      expect(mocked.copyClipboardText).not.toHaveBeenCalled();

      useClipboardStore.setState({
        aiResult: { id: 2, action: 'translate', status: 'done', text: 'Hola', errorCode: null },
      });
      mocked.copyClipboardText.mockRejectedValue(new Error('boom'));
      await useClipboardStore.getState().copyAiResult();
      expect(useClipboardStore.getState().aiResultCopied).toBe(false);
    });

    it('borrar el elemento (o todo el historial) cierra su resultado', async () => {
      useClipboardStore.setState({
        entries: [entry(2), entry(1)],
        aiResult: { id: 2, action: 'explain', status: 'done', text: 'x', errorCode: null },
      });
      await useClipboardStore.getState().remove(1);
      expect(useClipboardStore.getState().aiResult?.id).toBe(2);

      await useClipboardStore.getState().remove(2);
      expect(useClipboardStore.getState().aiResult).toBeNull();

      useClipboardStore.setState({
        aiResult: { id: 1, action: 'explain', status: 'done', text: 'x', errorCode: null },
      });
      await useClipboardStore.getState().clear();
      expect(useClipboardStore.getState().aiResult).toBeNull();
    });
  });

  it('bind carga el historial y lo vuelve a pedir en cada cambio', async () => {
    const off = await useClipboardStore.getState().bind();
    expect(mocked.getClipboardHistory).toHaveBeenCalledTimes(1);

    mocked.getClipboardHistory.mockResolvedValue([entry(3), entry(2), entry(1)]);
    emitLocal('clipboard:changed', null);
    await vi.waitFor(() => expect(useClipboardStore.getState().entries).toHaveLength(3));

    off();
    emitLocal('clipboard:changed', null);
    expect(mocked.getClipboardHistory).toHaveBeenCalledTimes(2);
  });
});
