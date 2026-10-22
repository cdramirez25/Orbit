import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_SCHEDULE,
  DURATION_MINUTES,
  SCHEDULE_MINUTES,
  formatMinutes,
  remainingMs,
} from '@/lib/awake';

describe('pantalla encendida: opciones', () => {
  it('ofrece duraciones ordenadas y la propuesta inicial es una de ellas', () => {
    expect([...DURATION_MINUTES].sort((a, b) => a - b)).toEqual([...DURATION_MINUTES]);
    expect(DURATION_MINUTES).toContain(DEFAULT_DURATION_MINUTES);
    expect(DURATION_MINUTES).toContain(240); // las 4 horas del ejemplo
  });

  it('ofrece cada media hora del día y el horario inicial es una de ellas', () => {
    expect(SCHEDULE_MINUTES).toHaveLength(48);
    expect(SCHEDULE_MINUTES[0]).toBe(0);
    expect(SCHEDULE_MINUTES.at(-1)).toBe(23 * 60 + 30);
    expect(SCHEDULE_MINUTES).toContain(DEFAULT_SCHEDULE.start);
    expect(SCHEDULE_MINUTES).toContain(DEFAULT_SCHEDULE.end);
    expect(SCHEDULE_MINUTES).toContain(14 * 60); // las 2 pm del ejemplo
    expect(SCHEDULE_MINUTES).toContain(17 * 60); // las 5 pm del ejemplo
  });
});

describe('formatMinutes', () => {
  it('escribe minutos, horas o ambos con las unidades que se pasan', () => {
    expect(formatMinutes(30, 'h', 'min')).toBe('30 min');
    expect(formatMinutes(120, 'h', 'min')).toBe('2 h');
    expect(formatMinutes(90, 'h', 'min')).toBe('1 h 30 min');
  });
});

describe('remainingMs', () => {
  it('solo un tiempo en marcha tiene lo que falta, y nunca baja de cero', () => {
    expect(remainingMs({ mode: 'until', endsAt: 5_000 }, 2_000)).toBe(3_000);
    expect(remainingMs({ mode: 'until', endsAt: 5_000 }, 9_000)).toBe(0);
    expect(remainingMs({ mode: 'always' }, 0)).toBeNull();
    expect(remainingMs({ mode: 'off' }, 0)).toBeNull();
    expect(remainingMs({ mode: 'schedule', start: 0, end: 60 }, 0)).toBeNull();
  });
});
