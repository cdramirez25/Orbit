import { describe, expect, it } from 'vitest';

import {
  formatClock,
  formatDuration,
  formatMinuteOfDay,
  formatRelativeTime,
} from '@/lib/utils/time';

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('formatClock', () => {
  it('da la hora del día en el formato del idioma', () => {
    expect(formatClock(NOW, 'es', 'UTC')).toMatch(/12:00/);
    expect(formatClock(NOW + 13 * HOUR, 'en', 'UTC')).toMatch(/1:00\s?AM/i);
  });
});

describe('formatMinuteOfDay', () => {
  it('da una hora del día en el formato del idioma', () => {
    expect(formatMinuteOfDay(14 * 60, 'en')).toMatch(/2:00\s?PM/i);
    expect(formatMinuteOfDay(14 * 60 + 30, 'en')).toMatch(/2:30\s?PM/i);
    expect(formatMinuteOfDay(0, 'en')).toMatch(/12:00\s?AM/i);
    expect(formatMinuteOfDay(14 * 60, 'es')).toMatch(/2:00|14:00/);
  });
});

describe('formatRelativeTime', () => {
  it('dice "ahora" durante el primer minuto', () => {
    expect(formatRelativeTime(NOW - 10_000, NOW, 'es')).toBe('ahora');
    expect(formatRelativeTime(NOW - 10_000, NOW, 'en')).toBe('now');
  });

  it('usa minutos, horas y días según la antigüedad', () => {
    expect(formatRelativeTime(NOW - 5 * MINUTE, NOW, 'en')).toMatch(/5 min/);
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW, 'en')).toMatch(/3 hr/);
    expect(formatRelativeTime(NOW - 5 * 24 * HOUR, NOW, 'en')).toMatch(/5 days/);
  });

  it('en español lleva "hace"', () => {
    expect(formatRelativeTime(NOW - 5 * MINUTE, NOW, 'es')).toMatch(/hace 5 min/);
  });

  it('una hora un poco en el futuro (reloj desfasado) no rompe', () => {
    expect(formatRelativeTime(NOW + 20_000, NOW, 'es')).toBe('ahora');
  });
});

describe('formatDuration', () => {
  it('da minutos y segundos', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(187.9)).toBe('3:07');
  });

  it('pasada la hora añade las horas', () => {
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('un valor negativo no rompe', () => {
    expect(formatDuration(-4)).toBe('0:00');
  });
});
