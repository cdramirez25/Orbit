import { describe, expect, it } from 'vitest';

import { isMac, shortcutKeys } from '@/lib/shortcuts';

describe('shortcutKeys', () => {
  it('muestra Cmd en Mac y Ctrl en Windows', () => {
    expect(shortcutKeys('CommandOrControl+Shift+Space', true)).toEqual(['Cmd', 'Shift', 'Space']);
    expect(shortcutKeys('CommandOrControl+Shift+H', false)).toEqual(['Ctrl', 'Shift', 'H']);
  });

  it('deja el resto de las teclas como vienen', () => {
    expect(shortcutKeys('Alt+K', true)).toEqual(['Alt', 'K']);
  });
});

describe('isMac', () => {
  it('reconoce la plataforma por su nombre', () => {
    expect(isMac('MacIntel')).toBe(true);
    expect(isMac('Win32')).toBe(false);
    expect(isMac('')).toBe(false);
  });
});
