import { create } from 'zustand';

import { onEvent } from '@/ipc/events';
import { isAiError } from '@/lib/ai/ai-error';

interface AnswerStore {
  /** La última pregunta detectada (`null`: todavía ninguna en esta escucha). */
  question: string | null;
  /** La respuesta de la IA, que va llegando por trozos. */
  answer: string;
  streaming: boolean;
  /** Código del error de la IA para esta pregunta (`ai.unauthorized`…); `null` si no hubo. */
  errorCode: string | null;
  /** Vacía la respuesta (al empezar a escuchar de nuevo). */
  clear: () => void;
  /**
   * Enlaza con los eventos de Rust (`llm:start`, `llm:delta`, `llm:done`, `error`). Devuelve la
   * función que los desenlaza. Se llama una vez, al arrancar la ventana de la isla.
   */
  bind: () => Promise<() => void>;
}

const EMPTY = { question: null, answer: '', streaming: false, errorCode: null } as const;

export const useAnswerStore = create<AnswerStore>((set) => ({
  ...EMPTY,

  clear: () => set({ ...EMPTY }),

  bind: async () => {
    const unlisten = await Promise.all([
      onEvent('llm:start', ({ question }) =>
        set({ question, answer: '', streaming: true, errorCode: null }),
      ),
      onEvent('llm:delta', ({ text }) =>
        set((state) => (state.question === null ? state : { answer: state.answer + text })),
      ),
      onEvent('llm:done', () => set({ streaming: false })),
      onEvent('error', ({ code }) => {
        if (isAiError(code)) set({ errorCode: code, streaming: false });
      }),
    ]);
    return () => unlisten.forEach((off) => off());
  },
}));
