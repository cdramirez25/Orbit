/** Espejo de `EntryView` en `src-tauri/src/clipboard/history.rs`. */

export type ClipboardKind = 'text' | 'image';

export interface ClipboardEntry {
  id: number;
  kind: ClipboardKind;
  /** Cuándo se copió (milisegundos Unix). */
  copiedAtMs: number;
  /** Texto: los primeros caracteres. */
  text: string | null;
  /** Texto: cuántos caracteres tiene en total. */
  charCount: number | null;
  width: number | null;
  height: number | null;
  /** Imagen: miniatura como `data:image/png;base64,…`. */
  thumbnail: string | null;
}
