import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnswerStore } from '@/stores/answer.store';

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
  useAnswerStore.getState().clear();
});

describe('respuesta de la IA', () => {
  it('la pregunta abre la respuesta y los trozos se van juntando', async () => {
    await useAnswerStore.getState().bind();

    emit('llm:start', { question: '¿Capital de Australia?' });
    expect(useAnswerStore.getState()).toMatchObject({
      question: '¿Capital de Australia?',
      answer: '',
      streaming: true,
    });

    emit('llm:delta', { text: 'Can' });
    emit('llm:delta', { text: 'berra' });
    expect(useAnswerStore.getState().answer).toBe('Canberra');

    emit('llm:done', null);
    expect(useAnswerStore.getState().streaming).toBe(false);
    expect(useAnswerStore.getState().answer).toBe('Canberra');
  });

  it('una pregunta nueva borra la respuesta anterior', async () => {
    await useAnswerStore.getState().bind();
    emit('llm:start', { question: 'Primera' });
    emit('llm:delta', { text: 'vieja' });
    emit('llm:start', { question: 'Segunda' });

    expect(useAnswerStore.getState()).toMatchObject({
      question: 'Segunda',
      answer: '',
      errorCode: null,
    });
  });

  it('un trozo sin pregunta no hace nada', async () => {
    await useAnswerStore.getState().bind();
    emit('llm:delta', { text: 'suelto' });
    expect(useAnswerStore.getState().answer).toBe('');
  });

  it('un error de la IA se guarda y corta la espera; los de otras cosas se ignoran', async () => {
    await useAnswerStore.getState().bind();
    emit('llm:start', { question: 'P' });

    emit('error', { code: 'stt.modelMissing', message: 'x', recoverable: true });
    expect(useAnswerStore.getState().errorCode).toBeNull();
    expect(useAnswerStore.getState().streaming).toBe(true);

    emit('error', { code: 'ai.unauthorized', message: 'x', recoverable: true });
    expect(useAnswerStore.getState().errorCode).toBe('ai.unauthorized');
    expect(useAnswerStore.getState().streaming).toBe(false);
  });

  it('clear lo vacía y la función devuelta desenlaza los eventos', async () => {
    const unbind = await useAnswerStore.getState().bind();
    expect(handlers.size).toBe(4);
    emit('llm:start', { question: 'P' });

    useAnswerStore.getState().clear();
    expect(useAnswerStore.getState().question).toBeNull();

    unbind();
    expect(handlers.size).toBe(0);
  });
});
