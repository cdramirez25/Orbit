import type { NowPlaying } from '@/types';

/**
 * Segundos reproducidos en `nowMs`. Rust solo manda la posición al empezar la canción, pausar o
 * adelantar: mientras suena se calcula aquí. `null` si no hay duración (un directo) o posición.
 */
export function trackPosition(track: NowPlaying, nowMs: number): number | null {
  const { duration, position, positionAtMs } = track;
  if (duration === null || position === null || positionAtMs === null) return null;
  const elapsed = track.playing ? Math.max(0, nowMs - positionAtMs) / 1000 : 0;
  return Math.min(Math.max(position + elapsed, 0), duration);
}
