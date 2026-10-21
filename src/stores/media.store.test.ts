import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { emitLocal } from '@/ipc/events';
import { useMediaStore } from '@/stores/media.store';
import { nowPlaying } from '@/test/factories';
import type { NowPlaying } from '@/types';

vi.mock('@/ipc/commands', () => ({
  commands: { getNowPlaying: vi.fn(), sendMediaCommand: vi.fn() },
}));

const mocked = vi.mocked(commands);

const song: NowPlaying = nowPlaying({ title: 'Canción', artist: 'Artista' });

beforeEach(() => {
  vi.clearAllMocks();
  useMediaStore.setState({ nowPlaying: null });
  mocked.getNowPlaying.mockResolvedValue(song);
  mocked.sendMediaCommand.mockResolvedValue();
});

describe('media.store', () => {
  it('refresh carga lo que suena', async () => {
    await useMediaStore.getState().refresh();
    expect(useMediaStore.getState().nowPlaying).toEqual(song);
  });

  it('si no se puede leer, conserva lo que había', async () => {
    useMediaStore.setState({ nowPlaying: song });
    mocked.getNowPlaying.mockRejectedValue(new Error('boom'));
    await useMediaStore.getState().refresh();
    expect(useMediaStore.getState().nowPlaying).toEqual(song);
  });

  it('pausa y play se reflejan al instante y se mandan al reproductor', async () => {
    useMediaStore.setState({ nowPlaying: song });

    const pending = useMediaStore.getState().send('pause');
    expect(useMediaStore.getState().nowPlaying?.playing).toBe(false);
    await pending;
    expect(mocked.sendMediaCommand).toHaveBeenCalledWith('pause');

    await useMediaStore.getState().send('play');
    expect(useMediaStore.getState().nowPlaying?.playing).toBe(true);
  });

  it('siguiente y anterior no inventan nada: esperan al cambio real', async () => {
    useMediaStore.setState({ nowPlaying: song });
    await useMediaStore.getState().send('next');
    await useMediaStore.getState().send('previous');
    expect(mocked.sendMediaCommand).toHaveBeenNthCalledWith(1, 'next');
    expect(mocked.sendMediaCommand).toHaveBeenNthCalledWith(2, 'previous');
    expect(useMediaStore.getState().nowPlaying).toEqual(song);
  });

  it('playPause alterna: pausa lo que suena y reproduce lo que está en pausa', async () => {
    useMediaStore.setState({ nowPlaying: song });
    await useMediaStore.getState().playPause();
    expect(mocked.sendMediaCommand).toHaveBeenLastCalledWith('toggle');
    expect(useMediaStore.getState().nowPlaying?.playing).toBe(false);

    await useMediaStore.getState().playPause();
    expect(mocked.sendMediaCommand).toHaveBeenLastCalledWith('toggle');
    expect(useMediaStore.getState().nowPlaying?.playing).toBe(true);
  });

  it('playPause no hace nada si no suena nada', async () => {
    await useMediaStore.getState().playPause();
    expect(mocked.sendMediaCommand).not.toHaveBeenCalled();
  });

  it('si la orden falla, vuelve a lo real', async () => {
    useMediaStore.setState({ nowPlaying: song });
    mocked.sendMediaCommand.mockRejectedValue(new Error('boom'));
    mocked.getNowPlaying.mockResolvedValue({ ...song, playing: true });
    await useMediaStore.getState().send('pause');
    expect(useMediaStore.getState().nowPlaying?.playing).toBe(true);
  });

  it('bind carga lo que suena y se actualiza con cada cambio', async () => {
    const off = await useMediaStore.getState().bind();
    expect(useMediaStore.getState().nowPlaying).toEqual(song);

    const other = nowPlaying({ title: 'Otra', artist: null, playing: false });
    emitLocal('media:changed', other);
    expect(useMediaStore.getState().nowPlaying).toEqual(other);

    emitLocal('media:changed', null);
    expect(useMediaStore.getState().nowPlaying).toBeNull();

    off();
    emitLocal('media:changed', song);
    expect(useMediaStore.getState().nowPlaying).toBeNull();
  });
});
