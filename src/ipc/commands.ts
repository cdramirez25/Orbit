import { invoke, isTauri } from '@tauri-apps/api/core';

import { translate } from '@/i18n/locale.store';
import { emitLocal } from '@/ipc/events';
import { simulatedLevel } from '@/lib/audio/simulated-level';
import type {
  AiProviderId,
  AiSaveInput,
  AiStatus,
  ClipboardEntry,
  IslandAnchor,
  MediaCommand,
  IslandSettings,
  NotchInfo,
  NowPlaying,
  PermissionStatus,
  Point,
  PointerPosition,
  SessionMessage,
  SessionsState,
  SessionUpdate,
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

// Frases de ejemplo (en el idioma activo) que llegan palabra a palabra, como las del motor real.
const SAMPLE_PHRASES = ['transcript.sample1', 'transcript.sample3', 'transcript.sample2'] as const;
const WORD_MS = 280;
let transcriptSimulation: ReturnType<typeof setInterval> | undefined;
let answerSimulation: ReturnType<typeof setInterval> | undefined;

/** Como la IA: la pregunta empieza, la respuesta llega palabra a palabra y termina. */
function simulateAnswer(question: string): void {
  clearInterval(answerSimulation);
  emitLocal('llm:start', { question });
  const words = translate('answer.sample').split(' ');
  let sent = 0;
  answerSimulation = setInterval(() => {
    if (sent >= words.length) {
      clearInterval(answerSimulation);
      emitLocal('llm:done', null);
      return;
    }
    emitLocal('llm:delta', { text: `${sent === 0 ? '' : ' '}${words[sent]}` });
    sent += 1;
  }, WORD_MS / 2);
}

function simulateTranscript(): void {
  let phrase = 0;
  let shown = 0;
  transcriptSimulation = setInterval(() => {
    const text = translate(SAMPLE_PHRASES[phrase % SAMPLE_PHRASES.length] ?? 'transcript.sample1');
    const words = text.split(' ');
    shown += 1;
    if (shown >= words.length) {
      emitLocal('stt:final', { text, endOfUtterance: true });
      if (text.includes('?')) simulateAnswer(text);
      phrase += 1;
      shown = 0;
    } else {
      emitLocal('stt:partial', { text: words.slice(0, shown).join(' ') });
    }
  }, WORD_MS);
}

function startSimulation(): void {
  if (simulation !== undefined) return;
  emitLocal('pipeline:state', 'listening');
  simulateTranscript();
  const startedAt = Date.now();
  simulation = setInterval(
    () => emitLocal('audio:level', simulatedLevel((Date.now() - startedAt) / 1000)),
    SIMULATION_TICK_MS,
  );
}

function stopSimulation(): void {
  clearInterval(simulation);
  clearInterval(transcriptSimulation);
  clearInterval(answerSimulation);
  simulation = undefined;
  transcriptSimulation = undefined;
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

/** Solo navegador: salta a otro punto de la canción de muestra. */
function applyBrowserSeek(position: number): void {
  const duration = SAMPLE_TRACKS[browserTrack]!.duration;
  browserPosition = Math.min(Math.max(position, 0), duration);
  browserPositionAt = Date.now();
  emitLocal('media:changed', browserNowPlaying());
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

// Solo navegador: la IA en memoria (sin llavero ni red) para ver y probar la pantalla con `pnpm dev`.
const SAMPLE_PROVIDER_IDS: readonly AiProviderId[] = [
  'claude',
  'chatgpt',
  'groq',
  'ollama',
  'docker',
];
const SAMPLE_DEFAULT_MODELS: Partial<Record<AiProviderId, string>> = {
  claude: 'claude-haiku-5-5',
  groq: 'openai/gpt-oss-20b',
};
let browserAi: AiStatus = {
  active: null,
  providers: SAMPLE_PROVIDER_IDS.map((id) => ({
    id,
    baseUrl: null,
    model: null,
    defaultModel: SAMPLE_DEFAULT_MODELS[id] ?? null,
    hasKey: false,
  })),
};

function browserAiProvider(id: AiProviderId): AiStatus['providers'][number] {
  const provider = browserAi.providers.find((p) => p.id === id);
  if (!provider) throw { code: 'ai.notConfigured', message: 'sin proveedor' };
  return provider;
}

function browserAiSave(id: AiProviderId, input: AiSaveInput): AiStatus {
  const local = id === 'ollama' || id === 'docker';
  browserAi = {
    ...browserAi,
    providers: browserAi.providers.map((p) => {
      if (p.id !== id) return p;
      const hasKey = local || input.apiKey === undefined ? p.hasKey : input.apiKey.trim() !== '';
      const model = input.model === undefined ? p.model : input.model.trim() || null;
      const baseUrl =
        !local || input.baseUrl === undefined ? p.baseUrl : input.baseUrl.trim() || null;
      return { ...p, hasKey, model, baseUrl };
    }),
  };
  return browserAi;
}

/** Como en Rust: hace falta clave (si el proveedor la pide) y un modelo (elegido o por defecto). */
function browserAiCheck(id: AiProviderId): void {
  const provider = browserAiProvider(id);
  const local = id === 'ollama' || id === 'docker';
  if (!provider.model && !provider.defaultModel)
    throw { code: 'ai.missingModel', message: 'sin modelo' };
  if (!local && !provider.hasKey) throw { code: 'ai.missingKey', message: 'sin clave' };
}

// Solo navegador: las sesiones en memoria (sin base de datos) para ver y probar la pantalla.
let browserSessions: SessionsState = { active: null, sessions: [] };
const browserMessages = new Map<number, SessionMessage[]>();
let browserSessionId = 0;
let browserRecording = false;

function browserSessionsChanged(): SessionsState {
  emitLocal('sessions:changed', null);
  return browserSessions;
}

export const commands = {
  getNotchInfo: (): Promise<NotchInfo> =>
    isTauri() ? invoke<NotchInfo>('get_notch_info') : Promise.resolve(NO_NOTCH),

  /**
   * `true`: la isla puede recibir el teclado (mientras el usuario escribe una pregunta); `false`: se
   * lo devuelve a la app de antes. Fuera de Tauri no hace nada.
   */
  setIslandKeyboard: (enabled: boolean): Promise<void> =>
    isTauri() ? invoke<void>('set_island_keyboard', { enabled }) : Promise.resolve(),

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

  /** Salta a `position` segundos en la canción actual. Rechaza si no se puede (un directo). */
  seekMedia: (position: number): Promise<void> => {
    if (isTauri()) return invoke<void>('media_seek', { position });
    applyBrowserSeek(position);
    return Promise.resolve();
  },

  /** Qué proveedor de IA está activo y qué tiene guardado cada uno (nunca las claves). */
  aiGetStatus: (): Promise<AiStatus> =>
    isTauri() ? invoke<AiStatus>('ai_get_status') : Promise.resolve(browserAi),

  /** Guarda la clave (en el llavero del sistema), el modelo y la dirección de un proveedor. */
  aiSaveProvider: (id: AiProviderId, input: AiSaveInput): Promise<AiStatus> =>
    isTauri()
      ? invoke<AiStatus>('ai_save_provider', { id, input })
      : Promise.resolve(browserAiSave(id, input)),

  /** Elige con qué proveedor responde Orbit (`null`: ninguno). */
  aiSetActive: (id: AiProviderId | null): Promise<AiStatus> => {
    if (isTauri()) return invoke<AiStatus>('ai_set_active', { id });
    browserAi = { ...browserAi, active: id };
    return Promise.resolve(browserAi);
  },

  /** Prueba de verdad un proveedor con una petición mínima y devuelve lo que contestó. */
  aiTestProvider: (id: AiProviderId): Promise<string> => {
    if (isTauri()) return invoke<string>('ai_test_provider', { id });
    try {
      browserAiCheck(id);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve('ok');
  },

  /** Los modelos que ofrece un proveedor con la clave guardada. */
  aiListModels: (id: AiProviderId): Promise<string[]> => {
    if (isTauri()) return invoke<string[]>('ai_list_models', { id });
    try {
      browserAiCheck(id);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve([`${id}-modelo-1`, `${id}-modelo-2`]);
  },

  /** Le hace una pregunta escrita al proveedor activo; la respuesta sale en la isla. */
  aiAsk: (question: string): Promise<void> => {
    if (isTauri()) return invoke<void>('ai_ask', { question });
    simulateAnswer(question);
    return Promise.resolve();
  },

  /** Las sesiones y cuál está activa. */
  sessionGetState: (): Promise<SessionsState> =>
    isTauri() ? invoke<SessionsState>('session_get_state') : Promise.resolve(browserSessions),

  /** Crea una sesión (con su prompt) y la deja activa. */
  sessionCreate: (name: string, prompt = ''): Promise<SessionsState> => {
    if (isTauri()) return invoke<SessionsState>('session_create', { name, prompt });
    if (name.trim() === '')
      return Promise.reject({ code: 'session.emptyName', message: 'sin nombre' });
    browserSessionId += 1;
    const session = {
      id: browserSessionId,
      name: name.trim(),
      prompt: prompt.trim(),
      autoAnswer: false,
      provider: null,
      createdAt: Math.floor(Date.now() / 1000),
    };
    browserSessions = { active: session.id, sessions: [session, ...browserSessions.sessions] };
    return Promise.resolve(browserSessionsChanged());
  },

  /** Cambia el nombre, el prompt o la respuesta automática de una sesión. */
  sessionUpdate: (id: number, update: SessionUpdate): Promise<SessionsState> => {
    if (isTauri()) return invoke<SessionsState>('session_update', { id, update });
    browserSessions = {
      ...browserSessions,
      sessions: browserSessions.sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              name: update.name?.trim() || s.name,
              prompt: update.prompt?.trim() ?? s.prompt,
              autoAnswer: update.autoAnswer ?? s.autoAnswer,
              provider: update.provider === undefined ? s.provider : update.provider || null,
            }
          : s,
      ),
    };
    return Promise.resolve(browserSessionsChanged());
  },

  /** Borra una sesión con todo su historial. */
  sessionDelete: (id: number): Promise<SessionsState> => {
    if (isTauri()) return invoke<SessionsState>('session_delete', { id });
    const sessions = browserSessions.sessions.filter((s) => s.id !== id);
    browserMessages.delete(id);
    browserSessions = {
      sessions,
      active: browserSessions.active === id ? (sessions[0]?.id ?? null) : browserSessions.active,
    };
    return Promise.resolve(browserSessionsChanged());
  },

  /** Elige la sesión con la que se pregunta. */
  sessionSetActive: (id: number | null): Promise<SessionsState> => {
    if (isTauri()) return invoke<SessionsState>('session_set_active', { id });
    browserSessions = { ...browserSessions, active: id };
    return Promise.resolve(browserSessionsChanged());
  },

  /** Las preguntas y respuestas de una sesión, de la más antigua a la más nueva. */
  sessionMessages: (id: number): Promise<SessionMessage[]> =>
    isTauri()
      ? invoke<SessionMessage[]>('session_messages', { id })
      : Promise.resolve(browserMessages.get(id) ?? []),

  /** Vacía el historial de una sesión (conserva la sesión y su prompt). */
  sessionClear: (id: number): Promise<void> => {
    if (isTauri()) return invoke<void>('session_clear', { id });
    browserMessages.delete(id);
    browserSessionsChanged();
    return Promise.resolve();
  },

  /** Empieza a grabar una pregunta: se pone a escuchar el audio del sistema. */
  questionStart: (): Promise<void> => {
    if (isTauri()) return invoke<void>('question_start');
    browserRecording = true;
    startSimulation();
    return Promise.resolve();
  },

  /**
   * Termina la pregunta: deja de escuchar y se la hace a la IA con el contexto de la sesión.
   * Devuelve la pregunta; la respuesta llega por los eventos `llm:*`. Rechaza con
   * `ai.noQuestion` si no se oyó nada.
   */
  questionFinish: (): Promise<string> => {
    if (isTauri()) return invoke<string>('question_finish');
    browserRecording = false;
    stopSimulation();
    const question = translate('transcript.sample3');
    simulateAnswer(question);
    const active = browserSessions.active;
    if (active !== null) {
      const now = Math.floor(Date.now() / 1000);
      const list = browserMessages.get(active) ?? [];
      const id = list.length + 1;
      browserMessages.set(active, [
        ...list,
        { id, role: 'user', content: question, createdAt: now },
        { id: id + 1, role: 'assistant', content: translate('answer.sample'), createdAt: now },
      ]);
      browserSessionsChanged();
    }
    return Promise.resolve(question);
  },

  /** Cancela la grabación de la pregunta sin responder. */
  questionCancel: (): Promise<void> => {
    if (isTauri()) return invoke<void>('question_cancel');
    browserRecording = false;
    stopSimulation();
    return Promise.resolve();
  },

  /** ¿Se está grabando una pregunta? (por si la ventana se abrió con una grabación en marcha). */
  questionIsRecording: (): Promise<boolean> =>
    isTauri() ? invoke<boolean>('question_is_recording') : Promise.resolve(browserRecording),

  /** Abre la ventana de ajustes (solo en desarrollo) o la trae al frente. */
  openSettingsWindow: (): Promise<void> => {
    if (isTauri()) return invoke<void>('open_settings_window');
    // Navegador: otra pestaña con la misma app (comparte el bus de `ipc/remote.ts`).
    window.open('/settings.html', 'orbit-settings', 'popup,width=700,height=420');
    return Promise.resolve();
  },

  quitApp: (): Promise<void> => (isTauri() ? invoke<void>('quit_app') : Promise.resolve()),
};
