import { describe, expect, it } from 'vitest';

import { MESSAGES } from '@/i18n/messages';
import {
  CONDITION_KEYS,
  formatTemperature,
  speedUnit,
  weatherKind,
  type WeatherKind,
} from '@/lib/weather/weather-kind';

describe('weatherKind', () => {
  it.each<[number, WeatherKind]>([
    [0, 'clear'],
    [1, 'clear'],
    [2, 'partlyCloudy'],
    [3, 'cloudy'],
    [45, 'fog'],
    [53, 'drizzle'],
    [61, 'rain'],
    [81, 'rain'],
    [73, 'snow'],
    [86, 'snow'],
    [95, 'thunderstorm'],
    [99, 'thunderstorm'],
  ])('el código WMO %i es %s', (code, kind) => {
    expect(weatherKind(code)).toBe(kind);
  });

  it('un código desconocido se trata como nublado', () => {
    expect(weatherKind(1234)).toBe('cloudy');
  });

  it('cada tipo tiene texto en español e inglés', () => {
    for (const key of Object.values(CONDITION_KEYS)) {
      expect(MESSAGES.es[key]).toBeTruthy();
      expect(MESSAGES.en[key]).toBeTruthy();
    }
  });
});

describe('formato', () => {
  it('redondea la temperatura', () => {
    expect(formatTemperature(23.6)).toBe('24°');
    expect(formatTemperature(-0.4)).toBe('0°'); // nunca "-0°"
    expect(formatTemperature(-3.2)).toBe('-3°');
  });

  it('la unidad de viento depende del sistema de unidades', () => {
    expect(speedUnit('metric')).toBe('km/h');
    expect(speedUnit('imperial')).toBe('mph');
  });
});
