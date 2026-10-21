/** Espejo de `NowPlaying` y `MediaCommand` en `src-tauri/src/media/mod.rs`. */

/** Lo que suena ahora en el sistema (cualquier reproductor, navegadores incluidos). */
export interface NowPlaying {
  title: string;
  artist: string | null;
  playing: boolean;
  /** Portada lista para un `<img>` (`data:image/...;base64,...`). */
  artwork: string | null;
  /** Duración en segundos; `null` en un directo o si no se sabe (no hay barra de progreso). */
  duration: number | null;
  /** Segundos reproducidos en el instante `positionAtMs`. */
  position: number | null;
  /** Cuándo (milisegundos Unix) valía `position`. */
  positionAtMs: number | null;
}

export type MediaCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous';
