import type { NowPlaying } from '@/types';

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
