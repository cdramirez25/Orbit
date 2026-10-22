/** Hora del día (`13:05` / `1:05 PM`) en el idioma indicado. `timeZone` es opcional (tests). */
export function formatClock(ms: number, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(
    ms,
  );
}

/** Una hora del día dada en minutos desde la medianoche (`840` → `2:00 PM` / `14:00`), en el idioma indicado. */
export function formatMinuteOfDay(minute: number, locale: string): string {
  const time = new Date(2000, 0, 1, Math.floor(minute / 60), minute % 60);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(time);
}

/** Duración de una canción: `3:07`, o `1:02:03` si pasa de la hora. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

const SECONDS = { minute: 60, hour: 3600, day: 86_400 } as const;
/** Por debajo de esto se dice "ahora" en vez de "hace 12 s". */
const JUST_NOW_SECONDS = 45;

/** Tiempo relativo corto en el idioma indicado: `ahora`, `hace 5 min`, `hace 2 h`, `ayer`… */
export function formatRelativeTime(ms: number, nowMs: number, locale: string): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const seconds = Math.round((ms - nowMs) / 1000);
  if (Math.abs(seconds) < JUST_NOW_SECONDS) return formatter.format(0, 'second');

  const minutes = Math.round(seconds / SECONDS.minute);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');

  const hours = Math.round(seconds / SECONDS.hour);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');

  return formatter.format(Math.round(seconds / SECONDS.day), 'day');
}
