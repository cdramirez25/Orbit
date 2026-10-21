import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/** Regla del proyecto: ningún emoji en la aplicación; los iconos salen de `lucide-react`. */
const EMOJI = /\p{Extended_Pictographic}/u;
const ROOT = path.resolve(import.meta.dirname, '../..');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx|css|html)$/.test(entry.name) ? [full] : [];
  });
}

function offenders(paths: string[]): string[] {
  return paths
    .filter((file) => EMOJI.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file));
}

describe('sin emojis', () => {
  it('el código de la interfaz no contiene emojis', () => {
    expect(offenders(files(path.join(ROOT, 'src')))).toEqual([]);
  });

  it('los READMEs y las páginas HTML no contienen emojis', () => {
    const docs = ['README.md', 'docs/README.es.md', 'island.html', 'settings.html'];
    expect(offenders(docs.map((file) => path.join(ROOT, file)))).toEqual([]);
  });
});
