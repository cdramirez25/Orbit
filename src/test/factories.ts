import type { ModelEntry, ModelStatus, NowPlaying, SttModel } from '@/types';

/** Lo que suena en los tests; cada prueba cambia solo lo que le importa. */
export function nowPlaying(overrides: Partial<NowPlaying> = {}): NowPlaying {
  return {
    title: 'Canción de prueba',
    artist: 'Artista de prueba',
    playing: true,
    artwork: null,
    duration: null,
    position: null,
    positionAtMs: null,
    ...overrides,
  };
}

/** Tamaño real de cada modelo de voz, en bytes. */
export const MODEL_SIZES: Record<SttModel, number> = {
  base: 147_951_465,
  small: 487_601_967,
  medium: 1_533_763_059,
  turbo: 574_041_195,
};

/**
 * Los cuatro modelos de voz, todos sin descargar salvo lo que se indique en `entries`
 * (un modelo `ready` cuenta como descargado entero).
 */
export function modelStatus(
  options: {
    active?: SttModel;
    entries?: Partial<Record<SttModel, Partial<ModelEntry>>>;
    dir?: string;
    customDir?: boolean;
  } = {},
): ModelStatus {
  const models = (['base', 'small', 'medium', 'turbo'] as const).map((model): ModelEntry => {
    const patch = options.entries?.[model] ?? {};
    const total = MODEL_SIZES[model];
    const state = patch.state ?? 'missing';
    return {
      model,
      state,
      downloaded: state === 'ready' ? total : 0,
      total,
      error: null,
      ...patch,
    };
  });
  return {
    active: options.active ?? 'small',
    models,
    dir: options.dir ?? '/Users/yo/Library/Application Support/dev.orbit.island/models',
    customDir: options.customDir ?? false,
  };
}
