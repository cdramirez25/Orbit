import { describe, expect, it } from 'vitest';

import {
  batteryAlert,
  batteryTone,
  formatAgo,
  formatBytes,
  formatMinutes,
  formatRate,
  HISTORY_LENGTH,
  levelTone,
  loadLevel,
  memoryPercent,
  niceCeiling,
  pushSample,
  sparkIndexAt,
  sparkPaths,
  sparkPoint,
  type SparkGeometry,
} from '@/lib/system';
import type { Battery } from '@/types';

const battery = (overrides: Partial<Battery> = {}): Battery => ({
  percent: 80,
  state: 'discharging',
  minutesLeft: null,
  ...overrides,
});

describe('loadLevel', () => {
  it('avisa a partir del 75 % y es crítico desde el 90 %', () => {
    expect(loadLevel(0)).toBe('normal');
    expect(loadLevel(74.9)).toBe('normal');
    expect(loadLevel(75)).toBe('high');
    expect(loadLevel(89.9)).toBe('high');
    expect(loadLevel(90)).toBe('critical');
    expect(loadLevel(100)).toBe('critical');
  });

  it('cada nivel tiene su color: acento, aviso y peligro', () => {
    expect(levelTone('normal')).toBe('accent');
    expect(levelTone('high')).toBe('warning');
    expect(levelTone('critical')).toBe('danger');
  });
});

describe('batería', () => {
  it('avisa de batería baja solo mientras se gasta', () => {
    expect(batteryAlert(battery({ percent: 21 }))).toBeNull();
    expect(batteryAlert(battery({ percent: 20 }))).toBe('low');
    expect(batteryAlert(battery({ percent: 10 }))).toBe('critical');
    expect(batteryAlert(battery({ percent: 4, state: 'charging' }))).toBeNull();
    expect(batteryAlert(battery({ percent: 4, state: 'pluggedIn' }))).toBeNull();
  });

  it('el color: verde al cargar, acento al gastar, y aviso o peligro cuando está baja', () => {
    expect(batteryTone(battery({ state: 'charging' }))).toBe('good');
    expect(batteryTone(battery({ state: 'full', percent: 100 }))).toBe('good');
    expect(batteryTone(battery({ state: 'pluggedIn' }))).toBe('accent');
    expect(batteryTone(battery())).toBe('accent');
    expect(batteryTone(battery({ percent: 18 }))).toBe('warning');
    expect(batteryTone(battery({ percent: 6 }))).toBe('danger');
  });
});

describe('memoryPercent', () => {
  it('es lo usado sobre el total, y 0 si no se sabe el total', () => {
    expect(memoryPercent({ used: 4, total: 16 })).toBe(25);
    expect(memoryPercent({ used: 4, total: 0 })).toBe(0);
  });
});

describe('formatBytes', () => {
  const GIB = 1024 ** 3;

  it('da gigabytes con un decimal, con la coma del idioma', () => {
    expect(formatBytes(17.6 * GIB, 'en')).toBe('17.6 GB');
    expect(formatBytes(17.6 * GIB, 'es')).toBe('17,6 GB');
  });

  it('con poca memoria da megabytes', () => {
    expect(formatBytes(512 * 1024 ** 2, 'en')).toBe('512 MB');
  });
});

describe('formatRate', () => {
  it('elige la unidad según la velocidad', () => {
    expect(formatRate(0, 'en')).toEqual({ value: '0', unit: 'B/s' });
    expect(formatRate(900, 'en')).toEqual({ value: '900', unit: 'B/s' });
    expect(formatRate(1536, 'en')).toEqual({ value: '1.5', unit: 'KB/s' });
    expect(formatRate(340 * 1024, 'en')).toEqual({ value: '340', unit: 'KB/s' });
    expect(formatRate(1.2 * 1024 ** 2, 'en')).toEqual({ value: '1.2', unit: 'MB/s' });
    expect(formatRate(25 * 1024 ** 2, 'en')).toEqual({ value: '25', unit: 'MB/s' });
    expect(formatRate(2 * 1024 ** 3, 'en')).toEqual({ value: '2.0', unit: 'GB/s' });
  });

  it('usa la coma decimal del idioma', () => {
    expect(formatRate(1.2 * 1024 ** 2, 'es').value).toBe('1,2');
  });
});

describe('formatMinutes', () => {
  const units = { hour: 'h', minute: 'min' };

  it('da horas y minutos, y omite lo que sobra', () => {
    expect(formatMinutes(614, units)).toBe('10 h 14 min');
    expect(formatMinutes(120, units)).toBe('2 h');
    expect(formatMinutes(45, units)).toBe('45 min');
    expect(formatMinutes(0, units)).toBe('0 min');
  });

  it('un valor negativo no da un tiempo negativo', () => {
    expect(formatMinutes(-5, units)).toBe('0 min');
  });
});

describe('formatAgo', () => {
  it('dice cuánto hace, en el idioma', () => {
    expect(formatAgo(14, 'es')).toContain('14');
    expect(formatAgo(14, 'es')).toMatch(/hace/);
    expect(formatAgo(14, 'en')).toMatch(/14.*ago/);
  });
});

describe('pushSample', () => {
  it('añade al final y se queda con las últimas lecturas', () => {
    expect(pushSample([1, 2], 3)).toEqual([1, 2, 3]);
    const full = Array.from({ length: HISTORY_LENGTH }, (_, i) => i);
    const next = pushSample(full, 999);
    expect(next).toHaveLength(HISTORY_LENGTH);
    expect(next[0]).toBe(1);
    expect(next.at(-1)).toBe(999);
  });

  it('no toca la lista que recibe', () => {
    const history = [1, 2];
    pushSample(history, 3);
    expect(history).toEqual([1, 2]);
  });
});

describe('niceCeiling', () => {
  it('sube al siguiente 1, 2 o 5 por una potencia de 10', () => {
    expect(niceCeiling(70_000, 1)).toBe(100_000);
    expect(niceCeiling(130_000, 1)).toBe(200_000);
    expect(niceCeiling(300_000, 1)).toBe(500_000);
    expect(niceCeiling(600_000, 1)).toBe(1_000_000);
    expect(niceCeiling(100_000, 1)).toBe(100_000);
  });

  it('con poco tráfico se queda en el mínimo, para que no parezca una subida enorme', () => {
    expect(niceCeiling(300, 65_536)).toBe(100_000);
    expect(niceCeiling(0, 65_536)).toBe(100_000);
  });
});

describe('gráfica', () => {
  const geometry: SparkGeometry = { width: 126, height: 40, pad: 6, max: 100 };

  it('la lectura más nueva queda en el borde derecho y la escala va de 0 a max', () => {
    const last = sparkPoint(9, 10, 100, geometry);
    expect(last.x).toBe(120);
    expect(last.y).toBe(6);
    expect(sparkPoint(9, 10, 0, geometry).y).toBe(34);
  });

  it('con pocas lecturas, las viejas no ocupan el sitio de las que aún no existen', () => {
    const first = sparkPoint(0, 2, 50, geometry);
    const last = sparkPoint(1, 2, 50, geometry);
    expect(last.x).toBe(120);
    expect(first.x).toBeGreaterThan(100);
  });

  it('un valor fuera de la escala no se sale de la gráfica', () => {
    expect(sparkPoint(0, 1, 500, geometry).y).toBe(6);
    expect(sparkPoint(0, 1, -5, geometry).y).toBe(34);
    expect(sparkPoint(0, 1, 5, { ...geometry, max: 0 }).y).toBe(34);
  });

  it('el trazo y el relleno existen con dos lecturas o más', () => {
    expect(sparkPaths([], geometry)).toEqual({ line: '', area: '' });
    expect(sparkPaths([5], geometry)).toEqual({ line: '', area: '' });
    const { line, area } = sparkPaths([10, 20, 30], geometry);
    expect(line).toMatch(/^M[\d.]+ [\d.]+ L/);
    expect(area.startsWith(line)).toBe(true);
    expect(area.endsWith('Z')).toBe(true);
  });

  it('el puntero marca la lectura que tiene debajo, o ninguna', () => {
    expect(sparkIndexAt(120, 10, geometry)).toBe(9);
    expect(sparkIndexAt(120 - 2 * (114 / 59), 10, geometry)).toBe(7);
    expect(sparkIndexAt(6, 10, geometry)).toBeNull(); // el lado vacío, a la izquierda
    expect(sparkIndexAt(50, 0, geometry)).toBeNull();
  });
});
