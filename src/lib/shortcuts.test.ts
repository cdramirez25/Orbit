import { describe, expect, it } from 'vitest';

import { isMac, keyName, shortcutFromEvent, shortcutKeys } from '@/lib/shortcuts';

const press = (
  code: string,
  mods: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>> = {},
) => ({
  code,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
});

describe('shortcutKeys', () => {
  it('muestra Cmd en Mac y Ctrl en Windows', () => {
    expect(shortcutKeys('CommandOrControl+Shift+Space', true)).toEqual(['Cmd', 'Shift', 'Space']);
    expect(shortcutKeys('CommandOrControl+Shift+H', false)).toEqual(['Ctrl', 'Shift', 'H']);
  });

  it('Alt se llama Option en Mac y Super es Cmd en Mac y Win en Windows', () => {
    expect(shortcutKeys('Alt+K', true)).toEqual(['Option', 'K']);
    expect(shortcutKeys('Alt+K', false)).toEqual(['Alt', 'K']);
    expect(shortcutKeys('Super+K', false)).toEqual(['Win', 'K']);
    expect(shortcutKeys('Super+K', true)).toEqual(['Cmd', 'K']);
    expect(shortcutKeys('Control+K', true)).toEqual(['Ctrl', 'K']);
  });

  it('las teclas con nombre propio se muestran como se ven en el teclado', () => {
    expect(shortcutKeys('Alt+ArrowUp', false)).toEqual(['Alt', 'Up']);
    expect(shortcutKeys('Alt+Backquote', false)).toEqual(['Alt', '`']);
    expect(shortcutKeys('Alt+Numpad5', false)).toEqual(['Alt', 'Num 5']);
    expect(shortcutKeys('Alt+F5', false)).toEqual(['Alt', 'F5']);
  });
});

describe('isMac', () => {
  it('reconoce la plataforma por su nombre', () => {
    expect(isMac('MacIntel')).toBe(true);
    expect(isMac('Win32')).toBe(false);
    expect(isMac('')).toBe(false);
  });
});

describe('keyName', () => {
  it('quita el prefijo de letras y números y deja el resto', () => {
    expect(keyName('KeyH')).toBe('H');
    expect(keyName('Digit7')).toBe('7');
    expect(keyName('Space')).toBe('Space');
    expect(keyName('F13')).toBe('F13');
    expect(keyName('ArrowLeft')).toBe('ArrowLeft');
    expect(keyName('Numpad3')).toBe('Numpad3');
  });

  it('descarta lo que Rust no entiende como tecla de un atajo', () => {
    expect(keyName('Escape')).toBeNull();
    expect(keyName('F25')).toBeNull();
    expect(keyName('NumpadEnter')).toBeNull();
    expect(keyName('Unidentified')).toBeNull();
    expect(keyName('')).toBeNull();
  });
});

describe('shortcutFromEvent', () => {
  it('en Mac, Cmd es la tecla principal y Control se conserva aparte', () => {
    expect(shortcutFromEvent(press('KeyK', { meta: true, shift: true }), true)).toBe(
      'CommandOrControl+Shift+K',
    );
    expect(shortcutFromEvent(press('KeyK', { ctrl: true, alt: true }), true)).toBe('Control+Alt+K');
    expect(shortcutFromEvent(press('KeyK', { meta: true, ctrl: true }), true)).toBe(
      'CommandOrControl+Control+K',
    );
  });

  it('en Windows, Ctrl es la tecla principal y la tecla Windows es Super', () => {
    expect(shortcutFromEvent(press('KeyK', { ctrl: true, shift: true }), false)).toBe(
      'CommandOrControl+Shift+K',
    );
    expect(shortcutFromEvent(press('KeyK', { meta: true }), false)).toBe('Super+K');
  });

  it('los modificadores siempre salen en el mismo orden', () => {
    expect(shortcutFromEvent(press('Space', { shift: true, alt: true, meta: true }), true)).toBe(
      'CommandOrControl+Alt+Shift+Space',
    );
  });

  it('con solo modificadores pulsados o una tecla inútil no hay combinación todavía', () => {
    expect(shortcutFromEvent(press('MetaLeft', { meta: true }), true)).toBeNull();
    expect(shortcutFromEvent(press('ShiftRight', { shift: true }), true)).toBeNull();
    expect(shortcutFromEvent(press('Escape', { meta: true }), true)).toBeNull();
  });

  it('sin modificadores devuelve la tecla sola: Rust avisa que falta uno', () => {
    expect(shortcutFromEvent(press('KeyH'), true)).toBe('H');
  });
});
