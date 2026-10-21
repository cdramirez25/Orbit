import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown, type Span } from '@/lib/markdown';

/** Resumen legible de los trozos: `texto` normal, `*negrita*`, `_cursiva_`, `#código#`. */
const show = (spans: Span[]) =>
  spans
    .map(({ text, bold, italic, code }) =>
      code
        ? `#${text}#`
        : bold && italic
          ? `*_${text}_*`
          : bold
            ? `*${text}*`
            : italic
              ? `_${text}_`
              : text,
    )
    .join('|');

describe('texto en línea', () => {
  it('quita los asteriscos de una negrita y la marca', () => {
    expect(show(parseInline('La capital es **Canberra**.'))).toBe('La capital es |*Canberra*|.');
  });

  it('entiende cursivas con * y _, y negrita con __', () => {
    expect(show(parseInline('una *idea* y _otra_ y __fuerte__'))).toBe(
      'una |_idea_| y |_otra_| y |*fuerte*',
    );
  });

  it('negrita y cursiva a la vez', () => {
    expect(show(parseInline('***clave***'))).toBe('*_clave_*');
  });

  it('el código en línea no interpreta lo de dentro', () => {
    expect(show(parseInline('usa `**no negrita**` aquí'))).toBe('usa |#**no negrita**#| aquí');
  });

  it('un asterisco suelto, una viñeta o snake_case son texto', () => {
    expect(show(parseInline('2 * 3 = 6'))).toBe('2 * 3 = 6');
    expect(show(parseInline('la variable mi_variable_larga'))).toBe(
      'la variable mi_variable_larga',
    );
  });

  it('una marca sin cerrar (streaming) ya aplica el estilo y no deja asteriscos a la vista', () => {
    expect(show(parseInline('Es **Can'))).toBe('Es |*Can*');
    expect(show(parseInline('Es **Canberra**, y *aho'))).toBe('Es |*Canberra*|, y |_aho_');
    // Y cuando llega el resto, queda igual que si hubiera llegado de golpe.
    expect(show(parseInline('Es **Canberra**'))).toBe('Es |*Canberra*');
  });

  it('de un enlace solo se muestra el texto', () => {
    expect(show(parseInline('mira [la web](https://ejemplo.com) ya'))).toBe('mira la web ya');
  });

  it('texto vacío no da trozos', () => {
    expect(parseInline('')).toEqual([]);
  });

  it('el HTML se queda como texto, sin interpretarse', () => {
    expect(show(parseInline('<img src=x onerror=alert(1)> **ok**'))).toBe(
      '<img src=x onerror=alert(1)> |*ok*',
    );
  });
});

describe('bloques', () => {
  it('separa párrafos por líneas en blanco y conserva los saltos de línea', () => {
    const blocks = parseMarkdown('Primera línea\nsegunda línea\n\nOtro párrafo');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' });
    expect(blocks[0]?.kind === 'paragraph' && blocks[0].lines).toHaveLength(2);
  });

  it('listas con viñetas y numeradas', () => {
    const [bullets, numbered] = parseMarkdown('- uno\n- **dos**\n\n1. primero\n2) segundo');
    expect(bullets).toMatchObject({ kind: 'list', ordered: false });
    expect(bullets?.kind === 'list' && bullets.items.map(show)).toEqual(['uno', '*dos*']);
    expect(numbered).toMatchObject({ kind: 'list', ordered: true });
    expect(numbered?.kind === 'list' && numbered.items.map(show)).toEqual(['primero', 'segundo']);
  });

  it('una lista pegada a un párrafo no se mezcla con él', () => {
    const blocks = parseMarkdown('Mira:\n- a\n- b\nFin');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list', 'paragraph']);
  });

  it('los títulos se leen como un bloque propio', () => {
    expect(parseMarkdown('## Resumen\ntexto')).toMatchObject([
      { kind: 'heading' },
      { kind: 'paragraph' },
    ]);
  });

  it('bloques de código, también si todavía no se cerraron', () => {
    expect(parseMarkdown('```js\nconst a = 1;\n```\nfin')).toEqual([
      { kind: 'code', text: 'const a = 1;' },
      expect.objectContaining({ kind: 'paragraph' }),
    ]);
    expect(parseMarkdown('```\nlínea 1\nlínea 2')).toEqual([
      { kind: 'code', text: 'línea 1\nlínea 2' },
    ]);
  });

  it('un texto vacío no da bloques', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('  \n\n ')).toEqual([]);
  });
});
