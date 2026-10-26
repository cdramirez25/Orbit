/** Una salida de sonido del equipo. Espejo de `OutputDevice` en Rust (`sound_output/mod.rs`). */
export interface SoundOutputDevice {
  /** Identificador estable que da el sistema. */
  id: string;
  /** El nombre para mostrarlo. */
  name: string;
  /** ¿Es la salida que usa el sistema ahora? */
  isDefault: boolean;
}
