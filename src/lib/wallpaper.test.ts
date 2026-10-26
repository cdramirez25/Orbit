import { describe, expect, it } from 'vitest';

import {
  isScreenPaused,
  pauseReason,
  screenIndexOf,
  screenLabel,
  screenOf,
  soundSupport,
  targetScreen,
} from '@/lib/wallpaper';
import type { WallpaperScreen, WallpaperStatus } from '@/types';

const screen = (overrides: Partial<WallpaperScreen> = {}): WallpaperScreen => ({
  key: 'A',
  label: null,
  file: 'mar.mp4',
  kind: 'video',
  path: '/x/mar.mp4',
  sound: false,
  hasAudio: true,
  audible: false,
  missing: false,
  paused: false,
  ...overrides,
});

const status = (overrides: Partial<WallpaperStatus> = {}): WallpaperStatus => ({
  enabled: true,
  file: 'mar.mp4',
  sound: false,
  volume: 60,
  manualPause: false,
  performance: 'any',
  perScreen: false,
  screens: [screen({ key: 'A' }), screen({ key: 'B' })],
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

describe('screenOf', () => {
  it('devuelve lo que le toca al monitor por su posición, o nada si no existe', () => {
    expect(screenOf(status(), 1)?.key).toBe('B');
    expect(screenOf(status(), 2)).toBeNull();
    expect(screenOf(status({ screens: [] }), 0)).toBeNull();
  });
});

describe('screenLabel', () => {
  it('usa el nombre que da el sistema, o numera el monitor si no lo da', () => {
    expect(screenLabel(screen({ label: 'Built-in Retina Display' }), 0, 'Monitor')).toBe(
      'Built-in Retina Display',
    );
    expect(screenLabel(screen({ label: null }), 1, 'Monitor')).toBe('Monitor 2');
  });
});

describe('isScreenPaused', () => {
  it('una pausa a mano congela todos los monitores', () => {
    expect(isScreenPaused(status({ manualPause: true }), 0)).toBe(true);
    expect(isScreenPaused(status({ manualPause: true }), 1)).toBe(true);
  });

  it('el modo rendimiento congela solo el monitor con ventanas encima', () => {
    const pausedSecond = status({ screens: [screen(), screen({ key: 'B', paused: true })] });
    expect(isScreenPaused(pausedSecond, 0)).toBe(false);
    expect(isScreenPaused(pausedSecond, 1)).toBe(true);
  });

  it('un monitor que no está en la lista no está pausado', () => {
    expect(isScreenPaused(status({ screens: [] }), 3)).toBe(false);
  });
});

describe('pauseReason', () => {
  it('apagado o en movimiento no hay motivo', () => {
    expect(pauseReason(status({ enabled: false, manualPause: true }))).toBeNull();
    expect(pauseReason(status())).toBeNull();
  });

  it('la pausa a mano gana a la del rendimiento', () => {
    const bothPaused = [screen({ paused: true }), screen({ key: 'B', paused: true })];
    expect(pauseReason(status({ manualPause: true, screens: bothPaused }))).toBe('manual');
    expect(pauseReason(status({ screens: [screen(), screen({ key: 'B', paused: true })] }))).toBe(
      'performance',
    );
  });
});

describe('soundSupport', () => {
  it('un video con audio puede llevar sonido', () => {
    expect(soundSupport(screen({ hasAudio: true }))).toBe('ready');
  });

  it('un video sin pista de audio no puede', () => {
    expect(soundSupport(screen({ hasAudio: false }))).toBe('noAudio');
  });

  it('un video del que no se pudo saber se deja probar', () => {
    expect(soundSupport(screen({ hasAudio: null }))).toBe('unknown');
  });

  it('una imagen, un archivo que falta o nada elegido no llevan sonido', () => {
    expect(soundSupport(screen({ kind: 'image', hasAudio: null }))).toBe('noVideo');
    expect(soundSupport(screen({ missing: true, kind: null, path: null }))).toBe('noVideo');
    expect(soundSupport(screen({ file: null, kind: null, path: null }))).toBe('noVideo');
    expect(soundSupport(null)).toBe('noVideo');
  });
});

describe('targetScreen', () => {
  it('con el mismo fondo en todos, el monitor de referencia es el primero', () => {
    expect(targetScreen(status({ perScreen: false }), 'B')?.key).toBe('A');
  });

  it('con un fondo por monitor, el elegido; si ya no está conectado, el primero', () => {
    expect(targetScreen(status({ perScreen: true }), 'B')?.key).toBe('B');
    expect(targetScreen(status({ perScreen: true }), 'C')?.key).toBe('A');
    expect(targetScreen(status({ perScreen: true }), null)?.key).toBe('A');
  });

  it('sin monitores conocidos no hay a quién configurar', () => {
    expect(targetScreen(status({ perScreen: true, screens: [] }), 'A')).toBeNull();
  });
});
