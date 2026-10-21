import type { MessageKey } from '@/i18n/messages';
import type { Units } from '@/types';

/** Tipo de clima, más simple que los ~30 códigos WMO: lo que se dibuja y se nombra. */
export type WeatherKind =
  'clear' | 'partlyCloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunderstorm';

/** Código meteorológico WMO (el que entrega Open-Meteo) → tipo de clima. */
export function weatherKind(code: number): WeatherKind {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partlyCloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunderstorm';
  return 'cloudy'; // un código desconocido no debe romper la vista
}

export const CONDITION_KEYS: Record<WeatherKind, MessageKey> = {
  clear: 'weather.condition.clear',
  partlyCloudy: 'weather.condition.partlyCloudy',
  cloudy: 'weather.condition.cloudy',
  fog: 'weather.condition.fog',
  drizzle: 'weather.condition.drizzle',
  rain: 'weather.condition.rain',
  snow: 'weather.condition.snow',
  thunderstorm: 'weather.condition.thunderstorm',
};

/** Temperatura redondeada con el signo de grado: `24°`. */
export function formatTemperature(value: number): string {
  return `${Math.round(value)}°`;
}

export function speedUnit(units: Units): string {
  return units === 'imperial' ? 'mph' : 'km/h';
}
