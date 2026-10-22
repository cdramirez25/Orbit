/**
 * Qué quiere el usuario de la pantalla encendida. Espejo de `KeepAwakeSetting` en Rust
 * (`keep_awake/mod.rs`).
 */
export type KeepAwakeSetting =
  /** La pantalla se apaga como siempre. */
  | { mode: 'off' }
  /** Siempre encendida, hasta que se desactive. */
  | { mode: 'always' }
  /** Encendida hasta ese instante (milisegundos Unix). */
  | { mode: 'until'; endsAt: number }
  /** Todos los días de `start` a `end` (minutos desde la medianoche, hora local). */
  | { mode: 'schedule'; start: number; end: number };

/** Espejo de `KeepAwakeStatus` en Rust. */
export interface KeepAwakeStatus {
  setting: KeepAwakeSetting;
  /** ¿Se está manteniendo la pantalla encendida ahora mismo? (con un horario, puede que no) */
  active: boolean;
  /** Código del último fallo (`awake.*`); `null` si no hubo. */
  error: string | null;
}
