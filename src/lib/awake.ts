import type { KeepAwakeSetting } from '@/types';

/** Duraciones que se ofrecen para mantener la pantalla encendida, en minutos. */
export const DURATION_MINUTES: readonly number[] = [30, 60, 120, 180, 240, 360, 480, 720];

/** Las horas que se ofrecen para un horario: cada media hora del día, en minutos desde la medianoche. */
export const SCHEDULE_MINUTES: readonly number[] = Array.from({ length: 48 }, (_, i) => i * 30);

/** Horario que se propone al principio (el de una jornada). */
export const DEFAULT_SCHEDULE = { start: 9 * 60, end: 17 * 60 } as const;

/** Duración que se propone al principio. */
export const DEFAULT_DURATION_MINUTES = 120;

/** Una duración legible con las unidades ya traducidas: `30 min`, `2 h`, `1 h 30 min`. */
export function formatMinutes(minutes: number, hourUnit: string, minuteUnit: string): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} ${minuteUnit}`;
  return rest === 0 ? `${hours} ${hourUnit}` : `${hours} ${hourUnit} ${rest} ${minuteUnit}`;
}

/** Lo que falta para que termine un modo con tiempo, en milisegundos; `null` si el modo no tiene fin. */
export function remainingMs(setting: KeepAwakeSetting, nowMs: number): number | null {
  return setting.mode === 'until' ? Math.max(0, setting.endsAt - nowMs) : null;
}
