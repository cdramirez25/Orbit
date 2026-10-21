/** Hora del día (`13:05` / `1:05 PM`) en el idioma indicado. `timeZone` es opcional (tests). */
export function formatClock(ms: number, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(
    ms,
  );
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
