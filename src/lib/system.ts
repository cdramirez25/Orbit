import type { Battery } from '@/types';

/** Cada cuánto se lee el estado del equipo mientras el módulo está a la vista. */
export const POLL_MS = 1000;
/** Cuántas lecturas guarda la gráfica: un minuto. */
export const HISTORY_LENGTH = 60;

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** Nivel de una carga (CPU o memoria): a partir de qué porcentaje se avisa. */
export type Level = 'normal' | 'high' | 'critical';
const HIGH_FROM = 75;
const CRITICAL_FROM = 90;

export function loadLevel(percent: number): Level {
  if (percent >= CRITICAL_FROM) return 'critical';
  if (percent >= HIGH_FROM) return 'high';
  return 'normal';
}

/** Color de un medidor: el acento, y los de estado cuando algo merece atención. */
export type Tone = 'accent' | 'good' | 'warning' | 'danger';

export function levelTone(level: Level): Tone {
  if (level === 'critical') return 'danger';
  if (level === 'high') return 'warning';
  return 'accent';
}

const LOW_BATTERY = 20;
const CRITICAL_BATTERY = 10;

/** Aviso de batería: solo mientras se gasta (si está conectada no hay nada de qué avisar). */
export type BatteryAlert = 'low' | 'critical' | null;

export function batteryAlert(battery: Battery): BatteryAlert {
  if (battery.state !== 'discharging') return null;
  if (battery.percent <= CRITICAL_BATTERY) return 'critical';
  if (battery.percent <= LOW_BATTERY) return 'low';
  return null;
}

export function batteryTone(battery: Battery): Tone {
  const alert = batteryAlert(battery);
  if (alert === 'critical') return 'danger';
  if (alert === 'low') return 'warning';
  if (battery.state === 'charging' || battery.state === 'full') return 'good';
  return 'accent';
}

export function memoryPercent(memory: { used: number; total: number }): number {
  return memory.total > 0 ? (memory.used / memory.total) * 100 : 0;
}

function decimal(value: number, locale: string, digits: number): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Memoria: `17,6 GB` (o `512 MB` si es poca). */
export function formatBytes(bytes: number, locale: string): string {
  if (bytes >= GIB) return `${decimal(bytes / GIB, locale, 1)} GB`;
  return `${decimal(bytes / MIB, locale, 0)} MB`;
}

/** Velocidad de la red partida en cifra y unidad, para poder darles estilo distinto. */
export function formatRate(bytesPerSec: number, locale: string): { value: string; unit: string } {
  if (bytesPerSec < KIB) return { value: decimal(Math.round(bytesPerSec), locale, 0), unit: 'B/s' };
  const [divisor, unit] =
    bytesPerSec >= GIB
      ? ([GIB, 'GB/s'] as const)
      : bytesPerSec >= MIB
        ? ([MIB, 'MB/s'] as const)
        : ([KIB, 'KB/s'] as const);
  const value = bytesPerSec / divisor;
  return { value: decimal(value, locale, value < 10 ? 1 : 0), unit };
}

/** Minutos como `2 h 5 min` o `45 min` (las unidades las pone quien llama, ya traducidas). */
export function formatMinutes(minutes: number, units: { hour: string; minute: string }): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} ${units.minute}`;
  return rest === 0 ? `${hours} ${units.hour}` : `${hours} ${units.hour} ${rest} ${units.minute}`;
}

/** Cuándo fue una lectura (`hace 14 s`), en el idioma indicado. */
export function formatAgo(secondsAgo: number, locale: string): string {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'narrow' }).format(
    -Math.max(0, Math.round(secondsAgo)),
    'second',
  );
}

/** Añade una lectura al final y se queda con las últimas `HISTORY_LENGTH`. */
export function pushSample(history: readonly number[], value: number): number[] {
  const next = [...history, value];
  return next.length > HISTORY_LENGTH ? next.slice(next.length - HISTORY_LENGTH) : next;
}

/**
 * Tope de la escala de la gráfica de red: el siguiente 1, 2 o 5 por una potencia de 10 por encima
 * de lo más alto visto. `floor` evita que un hilo de tráfico se vea como una subida enorme.
 */
export function niceCeiling(highest: number, floor: number): number {
  const target = Math.max(highest, floor);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= target) return step * magnitude;
  }
  return 10 * magnitude;
}

export interface SparkGeometry {
  width: number;
  height: number;
  /** Margen para que el punto del final y su aro no se corten. */
  pad: number;
  /** Valor que queda arriba del todo. */
  max: number;
}

export interface SparkPoint {
  x: number;
  y: number;
}

/** Posición de la lectura `index` de `length`; las lecturas nuevas entran por la derecha. */
export function sparkPoint(
  index: number,
  length: number,
  value: number,
  geometry: SparkGeometry,
): SparkPoint {
  const { width, height, pad, max } = geometry;
  const slot = HISTORY_LENGTH - length + index;
  const x = pad + (slot / (HISTORY_LENGTH - 1)) * (width - pad * 2);
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return { x, y: pad + (1 - ratio) * (height - pad * 2) };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** El trazo de la gráfica y el relleno que lo acompaña (vacíos si hay menos de dos lecturas). */
export function sparkPaths(
  values: readonly number[],
  geometry: SparkGeometry,
): { line: string; area: string } {
  if (values.length < 2) return { line: '', area: '' };
  const points = values.map((value, index) => sparkPoint(index, values.length, value, geometry));
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const base = geometry.height - geometry.pad;
  return { line, area: `${line} L${round(last.x)} ${base} L${round(first.x)} ${base} Z` };
}

/** Qué lectura está bajo el puntero (`x` en las unidades de la gráfica), o `null` si ninguna. */
export function sparkIndexAt(x: number, length: number, geometry: SparkGeometry): number | null {
  if (length === 0) return null;
  const { width, pad } = geometry;
  const slot = Math.round(((x - pad) / (width - pad * 2)) * (HISTORY_LENGTH - 1));
  const index = slot - (HISTORY_LENGTH - length);
  return index >= 0 && index < length ? index : null;
}
