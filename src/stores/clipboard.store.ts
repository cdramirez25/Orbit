import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import { onEvent } from '@/ipc/events';
import type { ClipboardAiAction, ClipboardEntry } from '@/types';

/** Cuánto tiempo se muestra "Copiado" junto al elemento que se acaba de volver a copiar. */
const COPIED_FEEDBACK_MS = 1500;

let copiedTimer: ReturnType<typeof setTimeout> | undefined;
let resultCopiedTimer: ReturnType<typeof setTimeout> | undefined;
/** Número de la última petición a la IA: una respuesta que llega tarde (de una anterior) se descarta. */
let aiRun = 0;

/** Lo que la IA contestó (o está contestando) sobre un texto del historial. */
export interface ClipboardAiResult {
  /** El elemento del historial sobre el que se pidió. */
  id: number;
  action: ClipboardAiAction;
  status: 'working' | 'done' | 'error';
  text: string;
  /** Código del fallo (`ai.*`) si `status` es `error`. */
  errorCode: string | null;
}

interface ClipboardStore {
  /** Historial de esta sesión, lo más reciente primero. Solo vive en memoria. */
  entries: ClipboardEntry[];
  /** Elemento recién vuelto a copiar (para el aviso "Copiado"). */
  copiedId: number | null;
  /** El resultado de la última acción de IA (traducir, resumir, explicar); solo hay uno a la vez. */
  aiResult: ClipboardAiResult | null;
  /** El resultado se acaba de copiar (para el aviso "Copiado"). */
  aiResultCopied: boolean;
  refresh: () => Promise<void>;
  copy: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
  clear: () => Promise<void>;
  /** Le pide a la IA activa que traduzca, resuma o explique un texto del historial (`language`: el de la interfaz). */
  askAi: (id: number, action: ClipboardAiAction, language: string) => Promise<void>;
  /** Copia el resultado de la IA al portapapeles. */
  copyAiResult: () => Promise<void>;
  closeAiResult: () => void;
  /** Se suscribe a los cambios del historial y lo carga. Devuelve cómo desuscribirse. */
  bind: () => Promise<() => void>;
}

export const useClipboardStore = create<ClipboardStore>((set, get) => ({
  entries: [],
  copiedId: null,
  aiResult: null,
  aiResultCopied: false,

  refresh: async () => {
    try {
      set({ entries: await commands.getClipboardHistory() });
    } catch {
      // Se conserva lo que había; el siguiente cambio lo vuelve a pedir.
    }
  },

  copy: async (id) => {
    try {
      await commands.copyClipboardEntry(id);
    } catch {
      return; // no se pudo: no se muestra "Copiado"
    }
    set({ copiedId: id });
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      if (get().copiedId === id) set({ copiedId: null });
    }, COPIED_FEEDBACK_MS);
  },

  remove: async (id) => {
    if (get().aiResult?.id === id) get().closeAiResult();
    set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) }));
    try {
      await commands.deleteClipboardEntry(id);
    } catch {
      await get().refresh(); // si falló, se vuelve a lo real
    }
  },

  clear: async () => {
    get().closeAiResult();
    set({ entries: [], copiedId: null });
    try {
      await commands.clearClipboardHistory();
    } catch {
      await get().refresh();
    }
  },

  askAi: async (id, action, language) => {
    const run = ++aiRun;
    set({
      aiResult: { id, action, status: 'working', text: '', errorCode: null },
      aiResultCopied: false,
    });
    try {
      const text = await commands.clipboardAi(id, action, language);
      if (run !== aiRun) return;
      set({ aiResult: { id, action, status: 'done', text, errorCode: null } });
    } catch (error) {
      if (run !== aiRun) return;
      const errorCode = commandErrorCode(error) ?? 'unknown';
      set({ aiResult: { id, action, status: 'error', text: '', errorCode } });
    }
  },

  copyAiResult: async () => {
    const result = get().aiResult;
    if (result?.status !== 'done' || !result.text) return;
    try {
      await commands.copyClipboardText(result.text);
    } catch {
      return; // no se pudo: no se muestra "Copiado"
    }
    set({ aiResultCopied: true });
    clearTimeout(resultCopiedTimer);
    resultCopiedTimer = setTimeout(() => set({ aiResultCopied: false }), COPIED_FEEDBACK_MS);
  },

  closeAiResult: () => {
    aiRun += 1; // lo que todavía venga en camino ya no se muestra
    set({ aiResult: null, aiResultCopied: false });
  },

  bind: async () => {
    const off = await onEvent('clipboard:changed', () => void get().refresh());
    await get().refresh();
    return off;
  },
}));
