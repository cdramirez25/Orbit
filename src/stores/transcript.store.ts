import { create } from 'zustand';

import { onEvent } from '@/ipc/events';

/** Cuántas frases terminadas se conservan a la vista; las anteriores se descartan. */
export const MAX_LINES = 4;

export interface TranscriptLine {
  id: number;
  text: string;
}

interface TranscriptStore {
  /** Frases terminadas, de la más antigua a la más reciente. */
  lines: TranscriptLine[];
  /** La frase en curso: su texto todavía puede cambiar. */
  partial: string;
  /** Vacía la transcripción (al empezar a escuchar de nuevo). */
  clear: () => void;
  /**
   * Enlaza con los eventos de Rust (`stt:partial`, `stt:final`). Devuelve la función que los
   * desenlaza. Se llama una vez, al arrancar la ventana de la isla.
   */
  bind: () => Promise<() => void>;
}

let nextId = 0;

export const useTranscriptStore = create<TranscriptStore>((set) => ({
  lines: [],
  partial: '',

  clear: () => set({ lines: [], partial: '' }),

  bind: async () => {
    const unlisten = await Promise.all([
      onEvent('stt:partial', ({ text }) => set({ partial: text })),
      onEvent('stt:final', ({ text }) =>
        set((state) => ({
          lines: [...state.lines, { id: nextId++, text }].slice(-MAX_LINES),
          partial: '',
        })),
      ),
    ]);
    return () => unlisten.forEach((off) => off());
  },
}));
