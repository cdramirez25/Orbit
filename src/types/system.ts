/** Espejo de `SystemStats` y sus partes en `src-tauri/src/system_stats/`. */

/** Qué pasa con la batería: `pluggedIn` es conectado a la corriente pero sin cargar. */
export type BatteryState = 'charging' | 'discharging' | 'full' | 'pluggedIn';

export interface Battery {
  /** De 0 a 100. */
  percent: number;
  state: BatteryState;
  /** Minutos para vaciarse (`discharging`) o llenarse (`charging`), si el sistema lo sabe. */
  minutesLeft: number | null;
}

export interface SystemStats {
  cpu: { percent: number; cores: number };
  /** Bytes. */
  memory: { used: number; total: number };
  /** Bytes por segundo. */
  network: { downPerSec: number; upPerSec: number };
  /** `null` en un equipo sin batería (uno de escritorio). */
  battery: Battery | null;
}
