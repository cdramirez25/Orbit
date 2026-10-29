import { describe, expect, it } from 'vitest';

import { BATTERY_ICONS, batteryIconName } from '@/modules/system/battery-icon';
import type { Battery } from '@/types';

const battery = (overrides: Partial<Battery>): Battery => ({
  percent: 80,
  state: 'discharging',
  minutesLeft: null,
  ...overrides,
});

describe('batteryIconName', () => {
  it('el aviso gana a todo lo demás', () => {
    expect(batteryIconName(battery({ percent: 5 }))).toBe('critical');
    expect(batteryIconName(battery({ percent: 15 }))).toBe('low');
  });

  it('conectada: el enchufe o la carga, no el nivel', () => {
    expect(batteryIconName(battery({ state: 'charging', percent: 5 }))).toBe('charging');
    expect(batteryIconName(battery({ state: 'pluggedIn' }))).toBe('pluggedIn');
    expect(batteryIconName(battery({ state: 'full', percent: 100 }))).toBe('full');
  });

  it('con batería: el nivel', () => {
    expect(batteryIconName(battery({ percent: 90 }))).toBe('full');
    expect(batteryIconName(battery({ percent: 45 }))).toBe('medium');
    expect(batteryIconName(battery({ percent: 25 }))).toBe('empty');
  });

  it('todos los nombres tienen su icono', () => {
    for (const name of Object.keys(BATTERY_ICONS)) {
      expect(BATTERY_ICONS[name as keyof typeof BATTERY_ICONS]).toBeDefined();
    }
  });
});
