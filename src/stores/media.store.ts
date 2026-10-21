import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { onEvent } from '@/ipc/events';
import type { MediaCommand, NowPlaying } from '@/types';

interface MediaStore {
  /** Lo que suena ahora (`null`: nada). Nunca se guarda en disco ni se escribe en logs. */
  nowPlaying: NowPlaying | null;
  refresh: () => Promise<void>;
  /** Manda una orden al reproductor. Play, pausa y alternar se reflejan al instante; el resto, al cambiar. */
  send: (command: MediaCommand) => Promise<void>;
  /** Alterna play y pausa (la orden que mejor entienden todos los reproductores). */
  playPause: () => Promise<void>;
  /** Salta a `position` segundos. La barra se mueve al instante; si el reproductor no deja, vuelve. */
  seek: (position: number) => Promise<void>;
  /** Se suscribe a los cambios y carga lo que suena. Devuelve cómo desuscribirse. */
  bind: () => Promise<() => void>;
}

export const useMediaStore = create<MediaStore>((set, get) => ({
  nowPlaying: null,

  refresh: async () => {
    try {
      set({ nowPlaying: await commands.getNowPlaying() });
    } catch {
      // Se conserva lo que había; el siguiente cambio lo vuelve a pedir.
    }
  },

  send: async (command) => {
    const current = get().nowPlaying;
    if (current && (command === 'play' || command === 'pause' || command === 'toggle')) {
      const playing = command === 'toggle' ? !current.playing : command === 'play';
      set({ nowPlaying: { ...current, playing } });
    }
    try {
      await commands.sendMediaCommand(command);
    } catch {
      await get().refresh(); // si falló, se vuelve a lo real
    }
  },

  seek: async (position) => {
    const current = get().nowPlaying;
    if (!current || current.duration === null || !Number.isFinite(position)) return;
    const target = Math.min(Math.max(position, 0), current.duration);
    set({ nowPlaying: { ...current, position: target, positionAtMs: Date.now() } });
    try {
      await commands.seekMedia(target);
    } catch {
      await get().refresh(); // si no se pudo (un directo, un anuncio), se vuelve a lo real
    }
  },

  playPause: async () => {
    if (get().nowPlaying) await get().send('toggle');
  },

  bind: async () => {
    const off = await onEvent('media:changed', (nowPlaying) => set({ nowPlaying }));
    await get().refresh();
    return off;
  },
}));
