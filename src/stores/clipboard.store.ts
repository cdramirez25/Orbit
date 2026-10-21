import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { onEvent } from '@/ipc/events';
import type { ClipboardEntry } from '@/types';

/** Cuánto tiempo se muestra "Copiado" junto al elemento que se acaba de volver a copiar. */
const COPIED_FEEDBACK_MS = 1500;

let copiedTimer: ReturnType<typeof setTimeout> | undefined;

interface ClipboardStore {
  /** Historial de esta sesión, lo más reciente primero. Solo vive en memoria. */
  entries: ClipboardEntry[];
  /** Elemento recién vuelto a copiar (para el aviso "Copiado"). */
  copiedId: number | null;
  refresh: () => Promise<void>;
  copy: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
  clear: () => Promise<void>;
  /** Se suscribe a los cambios del historial y lo carga. Devuelve cómo desuscribirse. */
  bind: () => Promise<() => void>;
}

export const useClipboardStore = create<ClipboardStore>((set, get) => ({
  entries: [],
  copiedId: null,

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
    set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) }));
    try {
      await commands.deleteClipboardEntry(id);
    } catch {
      await get().refresh(); // si falló, se vuelve a lo real
    }
  },

  clear: async () => {
    set({ entries: [], copiedId: null });
    try {
      await commands.clearClipboardHistory();
    } catch {
      await get().refresh();
    }
  },

  bind: async () => {
    const off = await onEvent('clipboard:changed', () => void get().refresh());
    await get().refresh();
    return off;
  },
}));
