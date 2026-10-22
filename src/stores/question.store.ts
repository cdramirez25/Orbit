import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';

interface QuestionStore {
  /** ¿Se está grabando una pregunta con el botón? */
  recording: boolean;
  /** Algo está empezando o terminando (el botón espera). */
  busy: boolean;
  /** Código del último error (`ai.noQuestion`, `audio.permissionDenied`…); `null` si no hubo. */
  errorCode: string | null;
  /** Empieza a grabar: se pone a escuchar el audio del sistema. */
  start: () => Promise<void>;
  /** Termina: se le hace la pregunta a la IA con el contexto de la sesión. */
  finish: () => Promise<void>;
  /** Cancela la grabación sin responder. */
  cancel: () => Promise<void>;
  /** Pregunta a Rust si ya se estaba grabando (por si la ventana se abrió después). */
  sync: () => Promise<void>;
  /** Le hace una pregunta escrita a la IA, con el contexto de la sesión; la respuesta sale en la isla. */
  ask: (question: string) => Promise<void>;
  /** La isla puede recibir el teclado mientras se escribe la pregunta (y se lo devuelve después). */
  setKeyboard: (enabled: boolean) => Promise<void>;
}

export const useQuestionStore = create<QuestionStore>((set, get) => ({
  recording: false,
  busy: false,
  errorCode: null,

  start: async () => {
    if (get().busy || get().recording) return;
    set({ busy: true, errorCode: null });
    try {
      await commands.questionStart();
      set({ recording: true });
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    } finally {
      set({ busy: false });
    }
  },

  finish: async () => {
    if (get().busy || !get().recording) return;
    set({ busy: true, errorCode: null });
    try {
      await commands.questionFinish();
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    } finally {
      set({ recording: false, busy: false });
    }
  },

  cancel: async () => {
    if (!get().recording) return;
    try {
      await commands.questionCancel();
    } catch {
      // Aunque falle, la interfaz deja de mostrar "grabando".
    }
    set({ recording: false, errorCode: null });
  },

  sync: async () => {
    try {
      set({ recording: await commands.questionIsRecording() });
    } catch {
      // Sin respuesta: se queda como estaba.
    }
  },

  ask: async (question) => {
    const text = question.trim();
    if (text === '' || get().recording) return;
    try {
      await commands.aiAsk(text);
    } catch {
      // Si no se pudo enviar, la isla no mostrará nada: no hay otra cosa que hacer aquí.
    }
  },

  setKeyboard: async (enabled) => {
    try {
      await commands.setIslandKeyboard(enabled);
    } catch {
      // Sin teclado no se puede escribir, pero grabar audio con el botón sigue funcionando.
    }
  },
}));
