import { describe, expect, it } from 'vitest';

import { isScreenPaused, pauseReason, screenIndexOf } from '@/lib/wallpaper';
import type { WallpaperStatus } from '@/types';

const status = (overrides: Partial<WallpaperStatus> = {}): WallpaperStatus => ({
  enabled: true,
  file: 'mar.mp4',
  kind: 'video',
  path: '/x/mar.mp4',
  manualPause: false,
  performance: 'any',
  screenPaused: [false, false],
  missing: false,
  folder: '/x',
  error: null,
  ...overrides,
});

describe('screenIndexOf', () => {
  it('lee el monitor de la etiqueta de la ventana', () => {
    expect(screenIndexOf('wallpaper-0')).toBe(0);
    expect(screenIndexOf('wallpaper-1')).toBe(1);
    expect(screenIndexOf('wallpaper-12')).toBe(12);
  });

  it('con una etiqueta que no es de fondo, el primer monitor', () => {
    expect(screenIndexOf('island')).toBe(0);
    expect(screenIndexOf('wallpaper-')).toBe(0);
    expect(screenIndexOf('wallpaper-x')).toBe(0);
    expect(screenIndexOf('wallpaper--3')).toBe(0);
  });
});

describe('isScreenPaused', () => {
  it('una pausa a mano congela todos los monitores', () => {
    expect(isScreenPaused(status({ manualPause: true }), 0)).toBe(true);
    expect(isScreenPaused(status({ manualPause: true }), 1)).toBe(true);
  });

  it('el modo rendimiento congela solo el monitor con ventanas encima', () => {
    const pausedSecond = status({ screenPaused: [false, true] });
    expect(isScreenPaused(pausedSecond, 0)).toBe(false);
    expect(isScreenPaused(pausedSecond, 1)).toBe(true);
  });

  it('un monitor que no está en la lista no está pausado', () => {
    expect(isScreenPaused(status({ screenPaused: [] }), 3)).toBe(false);
  });
});

describe('pauseReason', () => {
  it('apagado o en movimiento no hay motivo', () => {
    expect(pauseReason(status({ enabled: false, manualPause: true }))).toBeNull();
    expect(pauseReason(status())).toBeNull();
  });

  it('la pausa a mano gana a la del rendimiento', () => {
    expect(pauseReason(status({ manualPause: true, screenPaused: [true, true] }))).toBe('manual');
    expect(pauseReason(status({ screenPaused: [false, true] }))).toBe('performance');
  });
});
