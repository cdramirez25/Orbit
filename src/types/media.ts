/** Espejo de `NowPlaying` y `MediaCommand` en `src-tauri/src/media/mod.rs`. */

/** Lo que suena ahora en el sistema (cualquier reproductor, navegadores incluidos). */
export interface NowPlaying {
  title: string;
  artist: string | null;
  playing: boolean;
}

export type MediaCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous';
