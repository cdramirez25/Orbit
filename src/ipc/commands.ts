import { invoke, isTauri } from '@tauri-apps/api/core';

import { emitLocal } from '@/ipc/events';
import type {
  IslandAnchor,
  IslandSettings,
  NotchInfo,
  PermissionStatus,
  Point,
  PointerPosition,
} from '@/types';

/**
 * Única puerta hacia los comandos de Rust (§4.0). Fuera de Tauri (navegador / tests) devuelve
 * valores neutros para poder ver la isla con `pnpm dev` sin la ventana nativa.
 */

const NO_NOTCH: NotchInfo = {
  hasNotch: false,
  notchWidth: 0,
  notchHeight: 0,
  screenFrame: { x: 0, y: 0, width: 1440, height: 900 },
};

const DEFAULT_SETTINGS: IslandSettings = {
  hideFromScreenShare: true,
  islandAnchor: 'center',
  freeOrigin: null,
};

// En el navegador el puntero se rastrea con eventos del DOM (en Tauri lo da Rust).
let browserPointer: PointerPosition | null = null;
if (typeof window !== 'undefined' && !isTauri()) {
  window.addEventListener('pointermove', (e) => {
    browserPointer = { x: e.clientX, y: e.clientY };
  });
  document.documentElement.addEventListener('pointerleave', () => {
    browserPointer = null;
  });
}

// Solo navegador: simula la escucha (estado + volumen) para poder ver las ondas con `pnpm dev`.
const SIMULATION_TICK_MS = 33;
let simulation: ReturnType<typeof setInterval> | undefined;

function simulatedLevel(seconds: number): number {
  const wave =
    0.5 +
    0.3 * Math.sin(seconds * 5) +
    0.15 * Math.sin(seconds * 13.7) +
    0.1 * Math.sin(seconds * 29);
  return Math.min(1, Math.max(0, wave));
}

function startSimulation(): void {
  if (simulation !== undefined) return;
  emitLocal('pipeline:state', 'listening');
  const startedAt = Date.now();
  simulation = setInterval(
    () => emitLocal('audio:level', simulatedLevel((Date.now() - startedAt) / 1000)),
    SIMULATION_TICK_MS,
  );
}

function stopSimulation(): void {
  clearInterval(simulation);
  simulation = undefined;
  emitLocal('audio:level', 0);
  emitLocal('pipeline:state', 'idle');
}

export const commands = {
  getNotchInfo: (): Promise<NotchInfo> =>
    isTauri() ? invoke<NotchInfo>('get_notch_info') : Promise.resolve(NO_NOTCH),

  /** `true` = la ventana captura el mouse; `false` = click-through. */
  setIslandInteractive: (interactive: boolean): Promise<void> =>
    isTauri() ? invoke<void>('set_island_interactive', { interactive }) : Promise.resolve(),

  /** Posición del puntero respecto a la ventana (px lógicos) o `null` si está fuera. */
  getPointerPosition: (): Promise<PointerPosition | null> =>
    isTauri()
      ? invoke<PointerPosition | null>('get_pointer_position')
      : Promise.resolve(browserPointer),

  setContentProtected: (enabled: boolean): Promise<void> =>
    isTauri() ? invoke<void>('set_content_protected', { enabled }) : Promise.resolve(),

  getIslandSettings: (): Promise<IslandSettings> =>
    isTauri() ? invoke<IslandSettings>('get_island_settings') : Promise.resolve(DEFAULT_SETTINGS),

  /** Cambia el ancla (izquierda / centro / derecha / libre); Rust la aplica y la guarda. */
  setIslandAnchor: (anchor: IslandAnchor): Promise<IslandSettings> =>
    isTauri()
      ? invoke<IslandSettings>('set_island_anchor', { anchor })
      : Promise.resolve({ ...DEFAULT_SETTINGS, islandAnchor: anchor }),

  /** Esquina superior izquierda de la ventana (puntos lógicos globales). */
  getIslandOrigin: (): Promise<Point> =>
    isTauri() ? invoke<Point>('get_island_origin') : Promise.resolve({ x: 0, y: 0 }),

  /** Mueve la ventana (arrastre); con `commit` (al soltar) la posición se guarda. */
  setIslandOrigin: (x: number, y: number, commit: boolean): Promise<void> =>
    isTauri() ? invoke<void>('set_island_origin', { x, y, commit }) : Promise.resolve(),

  /** Estado del permiso para capturar el audio del sistema (fuera de Tauri: no requerido). */
  getAudioPermission: (): Promise<PermissionStatus> =>
    isTauri() ? invoke<PermissionStatus>('get_audio_permission') : Promise.resolve('notRequired'),

  /** Pide el permiso al sistema (su aviso sale solo la primera vez) y devuelve el estado. */
  requestAudioPermission: (): Promise<PermissionStatus> =>
    isTauri()
      ? invoke<PermissionStatus>('request_audio_permission')
      : Promise.resolve('notRequired'),

  /** Abre la pantalla de Ajustes del Sistema donde se concede el permiso. */
  openAudioPermissionSettings: (): Promise<void> =>
    isTauri() ? invoke<void>('open_audio_permission_settings') : Promise.resolve(),

  /** Empieza a escuchar el audio del sistema. Si falla rechaza con `{ code, message }`. */
  startListening: (): Promise<void> => {
    if (isTauri()) return invoke<void>('start_listening');
    startSimulation();
    return Promise.resolve();
  },

  stopListening: (): Promise<void> => {
    if (isTauri()) return invoke<void>('stop_listening');
    stopSimulation();
    return Promise.resolve();
  },

  isListening: (): Promise<boolean> =>
    isTauri() ? invoke<boolean>('is_listening') : Promise.resolve(simulation !== undefined),

  quitApp: (): Promise<void> => (isTauri() ? invoke<void>('quit_app') : Promise.resolve()),
};
