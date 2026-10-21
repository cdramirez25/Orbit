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
  useClipboardStore.setState({ entries: [], copiedId: null });
  mocked.getClipboardHistory.mockResolvedValue([entry(2), entry(1)]);
  mocked.copyClipboardEntry.mockResolvedValue();
  mocked.deleteClipboardEntry.mockResolvedValue();
  mocked.clearClipboardHistory.mockResolvedValue();
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
