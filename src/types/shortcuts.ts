/** Lo que un atajo global o la bandeja piden a la isla. Espejo de `UiAction` en Rust. */
export type UiAction = 'toggleQuestion' | 'toggleIsland';

/** Espejo de `ShortcutInfo` en Rust (`shortcuts.rs`). */
export interface ShortcutInfo {
  action: UiAction;
  /** Combinación tal como la entiende Rust (`CommandOrControl+Shift+Space`). */
  keys: string;
  /** `false` si otra app ya usa la combinación. */
  registered: boolean;
}
