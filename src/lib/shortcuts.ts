/** ¿Es un Mac? Cambia el nombre de la tecla principal (Cmd / Ctrl). */
export function isMac(
  platform: string = typeof navigator === 'undefined' ? '' : navigator.platform,
) {
  return /mac|iphone|ipad/i.test(platform);
}

/**
 * Las teclas de un atajo tal como las entiende Rust (`CommandOrControl+Shift+Space`), listas para
 * mostrarlas: `['Cmd', 'Shift', 'Space']` en Mac y `['Ctrl', 'Shift', 'Space']` en Windows.
 */
export function shortcutKeys(keys: string, mac: boolean = isMac()): string[] {
  return keys.split('+').map((key) => {
    if (key === 'CommandOrControl') return mac ? 'Cmd' : 'Ctrl';
    return key;
  });
}
