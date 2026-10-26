import type { WallpaperScreen, WallpaperStatus } from '@/types';

/** Prefijo de las etiquetas de las ventanas de fondo (`wallpaper-0`, `wallpaper-1`…); lo pone Rust. */
const LABEL_PREFIX = 'wallpaper-';

/** Qué monitor es una ventana de fondo, por su etiqueta (`wallpaper-1` → 1); 0 si no se reconoce. */
export function screenIndexOf(label: string): number {
  if (!label.startsWith(LABEL_PREFIX)) return 0;
  const index = Number.parseInt(label.slice(LABEL_PREFIX.length), 10);
  return Number.isInteger(index) && index >= 0 ? index : 0;
}

/** Lo que le toca al monitor `screen` (su posición en la lista); `null` si no hay tal monitor. */
export function screenOf(status: WallpaperStatus, screen: number): WallpaperScreen | null {
  return status.screens[screen] ?? null;
}

/** Cómo llamar a un monitor en pantalla: el nombre del sistema o, si no lo dice, `<respaldo> <número>`. */
export function screenLabel(screen: WallpaperScreen, index: number, fallback: string): string {
  return screen.label ?? `${fallback} ${index + 1}`;
}

/** ¿El fondo de ese monitor tiene que estar quieto: pausado a mano o por el modo rendimiento? */
export function isScreenPaused(status: WallpaperStatus, screen: number): boolean {
  return status.manualPause || screenOf(status, screen)?.paused === true;
}

/** Por qué está quieto el fondo, para el rótulo de Ajustes (`null` si se está moviendo o está apagado). */
export function pauseReason(status: WallpaperStatus): 'manual' | 'performance' | null {
  if (!status.enabled) return null;
  if (status.manualPause) return 'manual';
  return status.screens.some((screen) => screen.paused) ? 'performance' : null;
}

/**
 * Si el fondo de un monitor puede llevar sonido: `ready` (video con audio), `unknown` (video del que
 * no se pudo saber si tiene audio), `noAudio` (video sin pista de audio) o `noVideo` (una imagen o
 * nada elegido todavía).
 */
export type SoundSupport = 'ready' | 'unknown' | 'noAudio' | 'noVideo';

export function soundSupport(screen: WallpaperScreen | null): SoundSupport {
  if (!screen || screen.kind !== 'video' || screen.missing) return 'noVideo';
  if (screen.hasAudio === false) return 'noAudio';
  return screen.hasAudio === true ? 'ready' : 'unknown';
}

/**
 * El monitor que se está configurando en Ajustes: con un fondo por monitor, el elegido (o el primero
 * si ese ya no está conectado); con el mismo fondo en todos, el primero, que lleva lo mismo que los
 * demás.
 */
export function targetScreen(status: WallpaperStatus, key: string | null): WallpaperScreen | null {
  if (status.perScreen && key) {
    const chosen = status.screens.find((screen) => screen.key === key);
    if (chosen) return chosen;
  }
  return status.screens[0] ?? null;
}
