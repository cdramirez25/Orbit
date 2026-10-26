import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useWallpaperStore } from '@/stores/wallpaper.store';
import type { WallpaperItem, WallpaperScreen, WallpaperStatus } from '@/types';

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());

vi.mock('@/ipc/events', () => ({
  onEvent: vi.fn((name: string, handler: (payload: unknown) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));

vi.mock('@/ipc/commands', () => ({
  commands: {
    wallpaperStatus: vi.fn(),
    wallpaperList: vi.fn(),
    wallpaperSelect: vi.fn(),
    wallpaperSetSound: vi.fn(),
    wallpaperSetVolume: vi.fn(),
    wallpaperSetPerScreen: vi.fn(),
    wallpaperSetEnabled: vi.fn(),
    wallpaperSetPaused: vi.fn(),
    wallpaperSetPerformance: vi.fn(),
    wallpaperOpenFolder: vi.fn(),
    wallpaperAddFiles: vi.fn(),
    wallpaperPlay: vi.fn(),
    fileUrl: vi.fn((path: string) => `asset://${path}`),
    currentWindowLabel: vi.fn(() => null),
  },
}));

const mocked = vi.mocked(commands);

const screen = (overrides: Partial<WallpaperScreen> = {}): WallpaperScreen => ({
  key: 'A',
  label: null,
  file: 'mar.mp4',
  kind: 'video',
  path: '/x/mar.mp4',
  sound: false,
  hasAudio: true,
  audible: false,
  missing: false,
  paused: false,
  ...overrides,
});

const status = (overrides: Partial<WallpaperStatus> = {}): WallpaperStatus => ({
  enabled: true,
  file: 'mar.mp4',
  sound: false,
  volume: 60,
  manualPause: false,
  performance: 'any',
  perScreen: false,
  screens: [screen()],
  folder: '/x',
  error: null,
  ...overrides,
});

const item = (file: string, kind: WallpaperItem['kind'] = 'image'): WallpaperItem => ({
  file,
  kind,
  size: 10,
  path: `/x/${file}`,
  hasAudio: kind === 'video' ? true : null,
});

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  mocked.fileUrl.mockImplementation((path) => `asset://${path}`);
  mocked.currentWindowLabel.mockReturnValue(null);
  useWallpaperStore.setState({
    status: null,
    url: null,
    screen: 0,
    items: [],
    errorCode: null,
    adding: false,
  });
});

describe('fondo de pantalla', () => {
  it('al enlazar pide el estado, calcula la dirección del archivo y sigue los cambios', async () => {
    mocked.wallpaperStatus.mockResolvedValue(status());
    await useWallpaperStore.getState().bind();

    expect(useWallpaperStore.getState().status).toEqual(status());
    expect(useWallpaperStore.getState().url).toBe('asset:///x/mar.mp4');

    // Rust avisa de una pausa por rendimiento y de que se quitó el fondo.
    handlers.get('wallpaper:changed')?.(status({ screens: [screen({ paused: true })] }));
    expect(useWallpaperStore.getState().status?.screens[0]?.paused).toBe(true);

    handlers.get('wallpaper:changed')?.(
      status({
        enabled: false,
        file: null,
        screens: [screen({ file: null, kind: null, path: null })],
      }),
    );
    expect(useWallpaperStore.getState().url).toBeNull();
  });

  it('cada ventana de fondo carga el archivo de su propio monitor', async () => {
    const split = status({
      perScreen: true,
      screens: [
        screen({ key: 'A', path: '/x/mar.mp4' }),
        screen({ key: 'B', file: 'montana.png', kind: 'image', path: '/x/montana.png' }),
      ],
    });
    mocked.wallpaperStatus.mockResolvedValue(split);

    mocked.currentWindowLabel.mockReturnValue('wallpaper-0');
    await useWallpaperStore.getState().bind();
    expect(useWallpaperStore.getState().url).toBe('asset:///x/mar.mp4');

    mocked.currentWindowLabel.mockReturnValue('wallpaper-1');
    await useWallpaperStore.getState().bind();
    expect(useWallpaperStore.getState().url).toBe('asset:///x/montana.png');
  });

  it('una ventana de fondo sabe qué monitor es por su etiqueta', async () => {
    mocked.currentWindowLabel.mockReturnValue('wallpaper-1');
    mocked.wallpaperStatus.mockResolvedValue(status());
    await useWallpaperStore.getState().bind();
    expect(useWallpaperStore.getState().screen).toBe(1);
  });

  it('si no se puede pedir el estado, se queda sin él', async () => {
    mocked.wallpaperStatus.mockRejectedValue(new Error('x'));
    await useWallpaperStore.getState().bind();
    expect(useWallpaperStore.getState().status).toBeNull();
  });

  it('refresh lee la carpeta y le pone a cada archivo su dirección', async () => {
    mocked.wallpaperList.mockResolvedValue([item('a.png'), item('b.mp4', 'video')]);
    await useWallpaperStore.getState().refresh();
    expect(useWallpaperStore.getState().items.map((entry) => entry.url)).toEqual([
      'asset:///x/a.png',
      'asset:///x/b.mp4',
    ]);
  });

  it('si no se puede leer la carpeta, conserva la lista de antes', async () => {
    mocked.wallpaperList.mockResolvedValueOnce([item('a.png')]);
    await useWallpaperStore.getState().refresh();
    mocked.wallpaperList.mockRejectedValue(new Error('x'));
    await useWallpaperStore.getState().refresh();
    expect(useWallpaperStore.getState().items).toHaveLength(1);
  });

  it('elegir un fondo, pausarlo, cambiar el modo y apagarlo guardan lo que devuelve Rust', async () => {
    mocked.wallpaperSelect.mockResolvedValue(
      status({ file: 'a.png', screens: [screen({ file: 'a.png', kind: 'image' })] }),
    );
    await useWallpaperStore.getState().select('a.png');
    expect(mocked.wallpaperSelect).toHaveBeenCalledWith('a.png', null);
    expect(useWallpaperStore.getState().status?.file).toBe('a.png');

    mocked.wallpaperSetPaused.mockResolvedValue(status({ manualPause: true }));
    await useWallpaperStore.getState().setPaused(true);
    expect(mocked.wallpaperSetPaused).toHaveBeenCalledWith(true);
    expect(useWallpaperStore.getState().status?.manualPause).toBe(true);

    mocked.wallpaperSetPerformance.mockResolvedValue(status({ performance: 'large' }));
    await useWallpaperStore.getState().setPerformance('large');
    expect(mocked.wallpaperSetPerformance).toHaveBeenCalledWith('large');
    expect(useWallpaperStore.getState().status?.performance).toBe('large');

    mocked.wallpaperSetEnabled.mockResolvedValue(status({ enabled: false }));
    await useWallpaperStore.getState().setEnabled(false);
    expect(useWallpaperStore.getState().status?.enabled).toBe(false);
  });

  it('elegir un fondo para un monitor, el sonido, el volumen y el reparto van a Rust', async () => {
    mocked.wallpaperSelect.mockResolvedValue(status({ perScreen: true }));
    await useWallpaperStore.getState().select('a.png', 'B');
    expect(mocked.wallpaperSelect).toHaveBeenCalledWith('a.png', 'B');

    mocked.wallpaperSetSound.mockResolvedValue(status({ sound: true }));
    await useWallpaperStore.getState().setSound(true);
    expect(mocked.wallpaperSetSound).toHaveBeenLastCalledWith(true, null);
    expect(useWallpaperStore.getState().status?.sound).toBe(true);
    await useWallpaperStore.getState().setSound(false, 'B');
    expect(mocked.wallpaperSetSound).toHaveBeenLastCalledWith(false, 'B');

    mocked.wallpaperSetVolume.mockResolvedValue(status({ volume: 25 }));
    await useWallpaperStore.getState().setVolume(25);
    expect(mocked.wallpaperSetVolume).toHaveBeenCalledWith(25);
    expect(useWallpaperStore.getState().status?.volume).toBe(25);

    mocked.wallpaperSetPerScreen.mockResolvedValue(status({ perScreen: true }));
    await useWallpaperStore.getState().setPerScreen(true);
    expect(mocked.wallpaperSetPerScreen).toHaveBeenCalledWith(true);
    expect(useWallpaperStore.getState().status?.perScreen).toBe(true);
  });

  it('un fallo guarda su código, no cambia el estado y la siguiente orden lo limpia', async () => {
    useWallpaperStore.setState({ status: status() });
    mocked.wallpaperSelect.mockRejectedValue({ code: 'wallpaper.notFound', message: 'x' });

    await useWallpaperStore.getState().select('borrado.png');
    expect(useWallpaperStore.getState().errorCode).toBe('wallpaper.notFound');
    expect(useWallpaperStore.getState().status?.file).toBe('mar.mp4');

    mocked.wallpaperSetPaused.mockResolvedValue(status({ manualPause: true }));
    await useWallpaperStore.getState().setPaused(true);
    expect(useWallpaperStore.getState().errorCode).toBeNull();
  });

  it('un error sin código se guarda como desconocido', async () => {
    mocked.wallpaperSetEnabled.mockRejectedValue(new Error('x'));
    await useWallpaperStore.getState().setEnabled(true);
    expect(useWallpaperStore.getState().errorCode).toBe('unknown');
  });

  it('abrir la carpeta pide a Rust y guarda el fallo si lo hay', async () => {
    mocked.wallpaperOpenFolder.mockResolvedValue();
    await useWallpaperStore.getState().openFolder();
    expect(mocked.wallpaperOpenFolder).toHaveBeenCalledTimes(1);

    mocked.wallpaperOpenFolder.mockRejectedValue({ code: 'wallpaper.openFolder', message: 'x' });
    await useWallpaperStore.getState().openFolder();
    expect(useWallpaperStore.getState().errorCode).toBe('wallpaper.openFolder');
  });

  it('añadir archivos manda el título del selector, marca que copia y guarda la lista nueva', async () => {
    let finish: (items: WallpaperItem[]) => void = () => {};
    mocked.wallpaperAddFiles.mockImplementation(() => new Promise((resolve) => (finish = resolve)));

    const pending = useWallpaperStore.getState().addFiles('Elige');
    expect(useWallpaperStore.getState().adding).toBe(true);
    finish([item('nuevo.png')]);
    await pending;

    expect(mocked.wallpaperAddFiles).toHaveBeenCalledWith('Elige');
    expect(useWallpaperStore.getState().adding).toBe(false);
    expect(useWallpaperStore.getState().items.map((entry) => entry.file)).toEqual(['nuevo.png']);
  });

  it('pedir que el video se reproduzca se lo manda a Rust y no falla si Rust no responde', async () => {
    mocked.wallpaperPlay.mockResolvedValue();
    await useWallpaperStore.getState().requestPlay();
    expect(mocked.wallpaperPlay).toHaveBeenCalledTimes(1);

    mocked.wallpaperPlay.mockRejectedValue(new Error('x'));
    await expect(useWallpaperStore.getState().requestPlay()).resolves.toBeUndefined();
  });

  it('si añadir falla, deja de marcar que copia y guarda el código', async () => {
    mocked.wallpaperAddFiles.mockRejectedValue({ code: 'wallpaper.copy', message: 'x' });
    await useWallpaperStore.getState().addFiles('Elige');
    expect(useWallpaperStore.getState().adding).toBe(false);
    expect(useWallpaperStore.getState().errorCode).toBe('wallpaper.copy');
  });
});
