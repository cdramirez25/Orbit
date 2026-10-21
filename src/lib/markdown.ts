/**
 * Un Markdown mínimo para las respuestas de la IA: negritas, cursivas, código, títulos y listas.
 * Pensado para texto que llega en streaming: una marca que todavía no se cerró (`**Can`) ya aplica su
 * estilo al resto y no deja los asteriscos a la vista. No genera HTML: devuelve datos y el
 * componente los pinta, así que lo que diga la IA nunca puede inyectar nada en la pantalla.
 */

/** Un trozo de texto con su estilo. */
export interface Span {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
}

export type Block =
  | { kind: 'paragraph'; lines: Span[][] }
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; items: Span[][] }
  | { kind: 'code'; text: string };

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);
const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);

/** Texto en línea → trozos con estilo. */
export function parseInline(source: string): Span[] {
  const spans: Span[] = [];
  let bold = false;
  let italic = false;
  let code = false;
  let buffer = '';

  const flush = () => {
    if (buffer !== '') spans.push({ text: buffer, bold, italic, code });
    buffer = '';
  };
  const toggle = (apply: () => void) => {
    flush();
    apply();
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source.charAt(i);
    const next = source[i + 1];
    const previous = source[i - 1];

    if (char === '`') {
      toggle(() => (code = !code));
      continue;
    }
    if (code) {
      buffer += char; // dentro del código no se interpreta nada
      continue;
    }

    // Enlace [texto](url): solo se muestra el texto (la isla no abre enlaces).
    if (char === '[') {
      const close = source.indexOf('](', i);
      const end = close === -1 ? -1 : source.indexOf(')', close);
      if (close !== -1 && end !== -1 && !source.slice(i + 1, close).includes('\n')) {
        buffer += source.slice(i + 1, close);
        i = end;
        continue;
      }
    }

    if ((char === '*' || char === '_') && next === char) {
      // `**` y `__`: negrita. Se abre si lo siguiente no es un espacio; se cierra si lo anterior no lo es.
      const opening = !bold && !isSpace(source[i + 2]);
      const closing = bold && !isSpace(previous);
      if (opening || closing) {
        toggle(() => (bold = !bold));
        i += 1;
        continue;
      }
    }

    if (char === '*' || char === '_') {
      // `*` y `_`: cursiva. `*` suelto entre espacios (una viñeta, una multiplicación) es texto, y un
      // `_` dentro de una palabra (snake_case) también.
      const opening = !italic && !isSpace(next) && (char === '*' || !isWordChar(previous));
      const closing = italic && !isSpace(previous) && (char === '*' || !isWordChar(next));
      if (opening || closing) {
        toggle(() => (italic = !italic));
        continue;
      }
    }

    buffer += char;
  }
  flush();
  return spans;
}

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** Texto completo → bloques (párrafos, títulos, listas y código). */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', lines: paragraph.map(parseInline) });
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
      list = null;
    }
  };
  const closeAll = () => {
    closeParagraph();
    closeList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (FENCE.test(line)) {
      closeAll();
      const code: string[] = [];
      i += 1;
      // Si la valla no se cerró (streaming), todo lo que llega es código.
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      closeAll();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      closeAll();
      blocks.push({ kind: 'heading', spans: parseInline(heading[1] ?? '') });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      closeParagraph();
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) closeList();
      list ??= { ordered, items: [] };
      list.items.push(item[1] ?? '');
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }
  closeAll();
  return blocks;
}
