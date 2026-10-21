import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useMediaStore } from '@/stores/media.store';
import { nowPlaying } from '@/test/factories';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getNowPlaying: vi.fn(),
    sendMediaCommand: vi.fn(),
    seekMedia: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);
const song = () => nowPlaying({ duration: 200, position: 10, positionAtMs: 1_000, playing: true });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.seekMedia.mockResolvedValue();
  useMediaStore.setState({ nowPlaying: song() });
});

describe('saltar a otro punto de la canción', () => {
  it('manda la posición al reproductor y mueve la barra al instante', async () => {
    const before = Date.now();
    await useMediaStore.getState().seek(120);

    expect(mocked.seekMedia).toHaveBeenCalledWith(120);
    const current = useMediaStore.getState().nowPlaying;
    expect(current?.position).toBe(120);
    expect(current?.positionAtMs).toBeGreaterThanOrEqual(before);
    expect(current?.title).toBe('Canción de prueba');
  });

  it('no sale de la canción: ni por debajo de cero ni más allá del final', async () => {
    await useMediaStore.getState().seek(-30);
    expect(mocked.seekMedia).toHaveBeenLastCalledWith(0);

    await useMediaStore.getState().seek(9_999);
    expect(mocked.seekMedia).toHaveBeenLastCalledWith(200);
    expect(useMediaStore.getState().nowPlaying?.position).toBe(200);
  });

  it('ignora una posición que no es un número', async () => {
    await useMediaStore.getState().seek(Number.NaN);
    await useMediaStore.getState().seek(Number.POSITIVE_INFINITY);

    expect(mocked.seekMedia).not.toHaveBeenCalled();
    expect(useMediaStore.getState().nowPlaying?.position).toBe(10);
  });

  it('sin duración (un directo) o sin nada sonando no manda nada', async () => {
    useMediaStore.setState({ nowPlaying: nowPlaying({ duration: null }) });
    await useMediaStore.getState().seek(30);

    useMediaStore.setState({ nowPlaying: null });
    await useMediaStore.getState().seek(30);

    expect(mocked.seekMedia).not.toHaveBeenCalled();
  });

  it('si el reproductor no deja, la barra vuelve a lo real', async () => {
    mocked.seekMedia.mockRejectedValue({ code: 'media.notSeekable', message: 'no se puede' });
    mocked.getNowPlaying.mockResolvedValue(song());

    await useMediaStore.getState().seek(150);

    expect(mocked.getNowPlaying).toHaveBeenCalledTimes(1);
    expect(useMediaStore.getState().nowPlaying?.position).toBe(10);
  });
});
