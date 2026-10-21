import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_LINES, useTranscriptStore } from '@/stores/transcript.store';

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());

vi.mock('@/ipc/events', () => ({
  onEvent: vi.fn((name: string, handler: (payload: unknown) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));

const emit = (name: string, payload: unknown) => handlers.get(name)?.(payload);

beforeEach(() => {
  handlers.clear();
  useTranscriptStore.setState({ lines: [], partial: '' });
});

describe('transcripción en vivo', () => {
  it('un parcial reemplaza al anterior', async () => {
    await useTranscriptStore.getState().bind();

    emit('stt:partial', { text: 'hola' });
    emit('stt:partial', { text: 'hola mundo' });

    expect(useTranscriptStore.getState().partial).toBe('hola mundo');
    expect(useTranscriptStore.getState().lines).toEqual([]);
  });

  it('un final pasa a la lista y vacía el parcial', async () => {
    await useTranscriptStore.getState().bind();

    emit('stt:partial', { text: 'hola mun' });
    emit('stt:final', { text: 'hola mundo', endOfUtterance: true });

    const { lines, partial } = useTranscriptStore.getState();
    expect(lines.map((line) => line.text)).toEqual(['hola mundo']);
    expect(partial).toBe('');
  });

  it('solo se conservan las últimas frases', async () => {
    await useTranscriptStore.getState().bind();

    for (let i = 1; i <= MAX_LINES + 2; i += 1) {
      emit('stt:final', { text: `frase ${i}`, endOfUtterance: true });
    }

    const texts = useTranscriptStore.getState().lines.map((line) => line.text);
    expect(texts).toHaveLength(MAX_LINES);
    expect(texts[0]).toBe('frase 3');
    expect(texts.at(-1)).toBe(`frase ${MAX_LINES + 2}`);
  });

  it('cada frase tiene un id distinto (para pintar la lista)', async () => {
    await useTranscriptStore.getState().bind();
    emit('stt:final', { text: 'igual', endOfUtterance: true });
    emit('stt:final', { text: 'igual', endOfUtterance: true });

    const ids = useTranscriptStore.getState().lines.map((line) => line.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('clear lo vacía todo', async () => {
    await useTranscriptStore.getState().bind();
    emit('stt:final', { text: 'algo', endOfUtterance: true });
    emit('stt:partial', { text: 'más' });

    useTranscriptStore.getState().clear();

    expect(useTranscriptStore.getState().lines).toEqual([]);
    expect(useTranscriptStore.getState().partial).toBe('');
  });

  it('la función devuelta desenlaza los eventos', async () => {
    const unbind = await useTranscriptStore.getState().bind();
    expect(handlers.size).toBe(2);

    unbind();

    expect(handlers.size).toBe(0);
  });
});
