import type { WallpaperStatus } from '@/types';

/** Prefijo de las etiquetas de las ventanas de fondo (`wallpaper-0`, `wallpaper-1`…); lo pone Rust. */
const LABEL_PREFIX = 'wallpaper-';

/** Qué monitor es una ventana de fondo, por su etiqueta (`wallpaper-1` → 1); 0 si no se reconoce. */
export function screenIndexOf(label: string): number {
  if (!label.startsWith(LABEL_PREFIX)) return 0;
  const index = Number.parseInt(label.slice(LABEL_PREFIX.length), 10);
  return Number.isInteger(index) && index >= 0 ? index : 0;
}

/** ¿El fondo de ese monitor tiene que estar quieto: pausado a mano o por el modo rendimiento? */
export function isScreenPaused(status: WallpaperStatus, screen: number): boolean {
  return status.manualPause || status.screenPaused[screen] === true;
}

/** Por qué está quieto el fondo, para el rótulo de Ajustes (`null` si se está moviendo o está apagado). */
export function pauseReason(status: WallpaperStatus): 'manual' | 'performance' | null {
  if (!status.enabled) return null;
  if (status.manualPause) return 'manual';
  return status.screenPaused.some(Boolean) ? 'performance' : null;
}
