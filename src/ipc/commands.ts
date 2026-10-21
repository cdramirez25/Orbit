import { invoke, isTauri } from '@tauri-apps/api/core';

import { emitLocal } from '@/ipc/events';
import { simulatedLevel } from '@/lib/audio/simulated-level';
import type {
  ClipboardEntry,
  IslandAnchor,
  MediaCommand,
  IslandSettings,
  NotchInfo,
  NowPlaying,
  PermissionStatus,
  Point,
  PointerPosition,
  WeatherReport,
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

// Solo navegador: datos de muestra para ver el clima y el portapapeles con `pnpm dev`.
const SAMPLE_WEATHER: Omit<WeatherReport, 'fetchedAtMs'> = {
  location: {
    name: 'Sample City',
    country: 'Sample',
    countryCode: 'XX',
    latitude: 0,
    longitude: 0,
  },
  units: 'metric',
  current: {
    temperature: 24,
    apparentTemperature: 25.2,
    humidity: 81,
    windSpeed: 19.9,
    weatherCode: 2,
    isDay: true,
  },
  today: { temperatureMax: 31, temperatureMin: 23.5, precipitationProbability: 20 },
};

const SAMPLE_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#17dae2"/><stop offset="1" stop-color="#6366f1"/>' +
      '</linearGradient></defs><rect width="160" height="90" fill="url(#g)"/></svg>',
  );

const now = Date.now();
let browserClipboard: ClipboardEntry[] = [
  {
    id: 4,
    kind: 'text',
    copiedAtMs: now - 60_000,
    text: 'https://orbit.example/docs/getting-started',
    charCount: 42,
    width: null,
    height: null,
    thumbnail: null,
  },
  {
    id: 3,
    kind: 'image',
    copiedAtMs: now - 5 * 60_000,
    text: null,
    charCount: null,
    width: 1280,
    height: 720,
    thumbnail: SAMPLE_IMAGE,
  },
  {
    id: 2,
    kind: 'text',
    copiedAtMs: now - 12 * 60_000,
    text: 'Meeting tomorrow at 10:00 in room 3. Bring the printed report and the signed contract.',
    charCount: 87,
    width: null,
    height: null,
    thumbnail: null,
  },
  {
    id: 1,
    kind: 'text',
    copiedAtMs: now - 31 * 60_000,
    text: 'const total = items.reduce((sum, item) => sum + item.price, 0);',
    charCount: 63,
    width: null,
    height: null,
    thumbnail: null,
  },
];

function browserClipboardChanged(): void {
  emitLocal('clipboard:changed', null);
}

// Solo navegador: dos canciones de muestra para ver y probar los controles de música con `pnpm dev`.
const SAMPLE_COVER = (from: string, to: string): string =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      '</linearGradient></defs><rect width="120" height="120" fill="url(#g)"/></svg>',
  );
const SAMPLE_TRACKS: readonly {
  title: string;
  artist: string | null;
  artwork: string;
  duration: number;
}[] = [
  {
    title: 'Sample Track One',
    artist: 'Sample Artist',
    artwork: SAMPLE_COVER('#17dae2', '#6366f1'),
    duration: 187,
  },
  {
    title: 'Sample Track Two',
    artist: null,
    artwork: SAMPLE_COVER('#f59e0b', '#ef4444'),
    duration: 3723,
  },
];
let browserTrack = 0;
let browserPlaying = true;
let browserPosition = 42;
let browserPositionAt = Date.now();

function browserNowPlaying(): NowPlaying {
  const track = SAMPLE_TRACKS[browserTrack]!;
  return {
    ...track,
    playing: browserPlaying,
    position: browserPosition,
    positionAtMs: browserPositionAt,
  };
}

function applyBrowserMediaCommand(command: MediaCommand): void {
  const count = SAMPLE_TRACKS.length;
  const now = Date.now();
  // Como en Rust: la posición solo se actualiza al pausar, reanudar o cambiar de canción.
  const settle = () => {
    if (browserPlaying) browserPosition += (now - browserPositionAt) / 1000;
    browserPositionAt = now;
  };
  if (command === 'next' || command === 'previous') {
    browserTrack = (browserTrack + (command === 'next' ? 1 : count - 1)) % count;
    browserPosition = 0;
    browserPositionAt = now;
  } else {
    settle();
    if (command === 'play') browserPlaying = true;
    else if (command === 'pause') browserPlaying = false;
    else browserPlaying = !browserPlaying;
  }
  emitLocal('media:changed', browserNowPlaying());
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

  /** Clima de la zona del usuario. Con `force` se salta la caché de Rust (10 minutos). */
  getWeather: (force = false): Promise<WeatherReport> =>
    isTauri()
      ? invoke<WeatherReport>('get_weather', { force })
      : Promise.resolve({ ...SAMPLE_WEATHER, fetchedAtMs: Date.now() }),

  /** Historial del portapapeles de esta sesión, lo más reciente primero. */
  getClipboardHistory: (): Promise<ClipboardEntry[]> =>
    isTauri()
      ? invoke<ClipboardEntry[]>('get_clipboard_history')
      : Promise.resolve([...browserClipboard]),

  /** Vuelve a copiar un elemento del historial (sube al primer lugar). */
  copyClipboardEntry: (id: number): Promise<void> => {
    if (isTauri()) return invoke<void>('copy_clipboard_entry', { id });
    const entry = browserClipboard.find((item) => item.id === id);
    if (entry) {
      browserClipboard = [
        { ...entry, copiedAtMs: Date.now() },
        ...browserClipboard.filter((item) => item.id !== id),
      ];
      browserClipboardChanged();
    }
    return Promise.resolve();
  },

  deleteClipboardEntry: (id: number): Promise<void> => {
    if (isTauri()) return invoke<void>('delete_clipboard_entry', { id });
    browserClipboard = browserClipboard.filter((item) => item.id !== id);
    browserClipboardChanged();
    return Promise.resolve();
  },

  clearClipboardHistory: (): Promise<void> => {
    if (isTauri()) return invoke<void>('clear_clipboard_history');
    browserClipboard = [];
    browserClipboardChanged();
    return Promise.resolve();
  },

  /** Lo que suena ahora en el sistema, o `null` si no suena nada. */
  getNowPlaying: (): Promise<NowPlaying | null> =>
    isTauri() ? invoke<NowPlaying | null>('get_now_playing') : Promise.resolve(browserNowPlaying()),

  /** Play, pausa, anterior o siguiente al reproductor actual. */
  sendMediaCommand: (command: MediaCommand): Promise<void> => {
    if (isTauri()) return invoke<void>('media_command', { command });
    applyBrowserMediaCommand(command);
    return Promise.resolve();
  },

  /** Abre la ventana de ajustes (solo en desarrollo) o la trae al frente. */
  openSettingsWindow: (): Promise<void> => {
    if (isTauri()) return invoke<void>('open_settings_window');
    // Navegador: otra pestaña con la misma app (comparte el bus de `ipc/remote.ts`).
    window.open('/settings.html', 'orbit-settings', 'popup,width=700,height=420');
    return Promise.resolve();
  },

  quitApp: (): Promise<void> => (isTauri() ? invoke<void>('quit_app') : Promise.resolve()),
};
