/** ¿Es un Mac? Cambia el nombre de las teclas (Cmd / Ctrl, Option / Alt). */
export function isMac(
  platform: string = typeof navigator === 'undefined' ? '' : navigator.platform,
) {
  return /mac|iphone|ipad/i.test(platform);
}

/** Cómo se muestran las teclas con nombre propio (el resto se muestra tal cual). */
const KEY_LABELS: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'Num +',
};

/**
 * Las teclas de un atajo tal como las entiende Rust (`CommandOrControl+Shift+Space`), listas para
 * mostrarlas: `['Cmd', 'Shift', 'Space']` en Mac y `['Ctrl', 'Shift', 'Space']` en Windows.
 */
export function shortcutKeys(keys: string, mac: boolean = isMac()): string[] {
  return keys.split('+').map((key) => {
    switch (key) {
      case 'CommandOrControl':
        return mac ? 'Cmd' : 'Ctrl';
      case 'Control':
        return 'Ctrl';
      case 'Super':
        return mac ? 'Cmd' : 'Win';
      case 'Alt':
        return mac ? 'Option' : 'Alt';
      default:
        return KEY_LABELS[key] ?? key.replace(/^Numpad(\d)$/, 'Num $1');
    }
  });
}

/** Teclas que solo modifican: pulsarlas solas no es una combinación. */
const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'CapsLock',
  'Fn',
]);

/** Las teclas que Rust entiende como parte de un atajo (además de letras y números). */
const NAMED_KEY =
  /^(F([1-9]|1\d|2[0-4])|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right)|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Numpad(\d|Add))$/;

/** El nombre de una tecla (`event.code`) como lo escribe un atajo, o `null` si no sirve. */
export function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] ?? null;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1] ?? null;
  return NAMED_KEY.test(code) ? code : null;
}

type KeyEvent = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

/**
 * La combinación que el usuario acaba de pulsar, en el formato de Rust (`CommandOrControl+Alt+K`).
 * `null` mientras solo hay modificadores pulsados o la tecla no se puede usar en un atajo. La tecla
 * principal de cada sistema (Cmd en Mac, Ctrl en Windows) se escribe `CommandOrControl`, así el
 * mismo atajo vale en los dos.
 */
export function shortcutFromEvent(event: KeyEvent, mac: boolean = isMac()): string | null {
  if (MODIFIER_CODES.has(event.code)) return null;
  const key = keyName(event.code);
  if (key === null) return null;

  const main = mac ? event.metaKey : event.ctrlKey;
  const parts: string[] = [];
  if (main) parts.push('CommandOrControl');
  if (mac && event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (!mac && event.metaKey) parts.push('Super');
  return [...parts, key].join('+');
}
