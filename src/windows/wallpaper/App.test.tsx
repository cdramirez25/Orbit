import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWallpaperStore } from '@/stores/wallpaper.store';
import { App } from '@/windows/wallpaper/App';
import type { WallpaperScreen, WallpaperStatus } from '@/types';

vi.mock('@/ipc/commands', () => ({ commands: {} }));

const screenOf = (overrides: Partial<WallpaperScreen> = {}): WallpaperScreen => ({
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
  screens: [screenOf({ key: 'A' }), screenOf({ key: 'B' })],
  folder: '/x',
  error: null,
  ...overrides,
});

/** Pone el estado del fondo como lo dejaría el store en la ventana del monitor `screen`. */
function show(overrides: Partial<WallpaperStatus> = {}, screen = 0, url?: string | null) {
  const current = status(overrides);
  const mine = current.screens[screen];
  useWallpaperStore.setState({
    status: current,
    url: url === undefined ? (mine?.path ? `asset://localhost${mine.path}` : null) : url,
    screen,
  });
}

const screensWith = (first: Partial<WallpaperScreen>, second: Partial<WallpaperScreen> = {}) => [
  screenOf({ key: 'A', ...first }),
  screenOf({ key: 'B', ...second }),
];

let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  useWallpaperStore.setState({ status: null, url: null, screen: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const video = (container: HTMLElement) => container.querySelector('video') as HTMLVideoElement;

describe('ventana del fondo de pantalla', () => {
  it('sin nada elegido, o apagado, solo se ve negro', () => {
    const { container, rerender } = render(<App />);
    expect(container.querySelector('video, img')).toBeNull();

    act(() => show({ enabled: false }));
    rerender(<App />);
    expect(container.querySelector('video, img')).toBeNull();

    act(() => show({ screens: screensWith({ file: null, kind: null, path: null }) }));
    rerender(<App />);
    expect(container.querySelector('video, img')).toBeNull();
  });

  it('una imagen se dibuja a pantalla completa', () => {
    show({ screens: screensWith({ kind: 'image', path: '/x/montana.png' }) });
    const { container } = render(<App />);

    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', 'asset://localhost/x/montana.png');
    expect(image?.className).toContain('object-cover');
    expect(container.querySelector('video')).toBeNull();
  });

  it('un video va en bucle, siempre sin sonido y empieza a moverse', () => {
    show();
    const { container } = render(<App />);
    const element = video(container);

    expect(element).toHaveAttribute('src', 'asset://localhost/x/mar.mp4');
    expect(element.loop).toBe(true);
    expect(element.muted).toBe(true);
    expect(element.volume).toBe(0);
    expect(play).toHaveBeenCalled();
  });

  it('con sonido pedido y permitido, el video suena con el volumen elegido', () => {
    show({ volume: 40, screens: screensWith({ sound: true, audible: true }) });
    const { container } = render(<App />);
    const element = video(container);

    expect(element.muted).toBe(false);
    expect(element.volume).toBeCloseTo(0.4);
  });

  it('si el monitor no es el que reproduce el sonido, el video va en silencio aunque se pidiera', () => {
    show({ volume: 80, screens: screensWith({ sound: true, audible: true }, { sound: true }) }, 1);
    const { container } = render(<App />);

    expect(video(container).muted).toBe(true);
    expect(video(container).volume).toBe(0);
  });

  it('cambiar el sonido o el volumen con el video en marcha se aplica sin recargarlo', () => {
    show({ screens: screensWith({ sound: false }) });
    const { container, rerender } = render(<App />);
    const element = video(container);
    expect(element.muted).toBe(true);

    act(() => show({ volume: 25, screens: screensWith({ sound: true, audible: true }) }));
    rerender(<App />);
    expect(video(container)).toBe(element);
    expect(element.muted).toBe(false);
    expect(element.volume).toBeCloseTo(0.25);

    act(() => show({ volume: 25, screens: screensWith({ sound: false, audible: false }) }));
    rerender(<App />);
    expect(element.muted).toBe(true);
    expect(element.volume).toBe(0);
  });

  it('cada monitor dibuja su propio archivo', () => {
    const screens = screensWith(
      { path: '/x/mar.mp4' },
      { file: 'montana.png', kind: 'image', path: '/x/montana.png' },
    );
    show({ perScreen: true, screens }, 0);
    const first = render(<App />);
    expect(first.container.querySelector('video')).toHaveAttribute(
      'src',
      'asset://localhost/x/mar.mp4',
    );
    first.unmount();

    act(() => show({ perScreen: true, screens }, 1));
    const second = render(<App />);
    expect(second.container.querySelector('img')).toHaveAttribute(
      'src',
      'asset://localhost/x/montana.png',
    );
    expect(second.container.querySelector('video')).toBeNull();
  });

  it('un monitor sin fondo propio se queda en negro', () => {
    show({ perScreen: true, screens: screensWith({}, { file: null, kind: null, path: null }) }, 1);
    const { container } = render(<App />);
    expect(container.querySelector('video, img')).toBeNull();
  });

  it('si el sistema deja quieto un video que debía moverse, se vuelve a lanzar', () => {
    vi.useFakeTimers();
    try {
      const requestPlay = vi.fn().mockResolvedValue(undefined);
      useWallpaperStore.setState({ requestPlay });
      show();
      render(<App />);
      play.mockClear();

      vi.advanceTimersByTime(500);

      expect(play).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('la pausa a mano congela el video y reanudar lo mueve', () => {
    show();
    const { container, rerender } = render(<App />);
    pause.mockClear();

    act(() => show({ manualPause: true }));
    rerender(<App />);
    expect(pause).toHaveBeenCalled();

    play.mockClear();
    act(() => show({ manualPause: false }));
    rerender(<App />);
    expect(play).toHaveBeenCalled();
    expect(video(container).muted).toBe(true);
  });

  it('el modo rendimiento congela solo el monitor al que le toca', () => {
    // Esta ventana es el segundo monitor y solo ese tiene una ventana encima.
    show({ screens: screensWith({}, { paused: true }) }, 1);
    const { rerender } = render(<App />);
    expect(pause).toHaveBeenCalled();

    pause.mockClear();
    play.mockClear();
    act(() => show({ screens: screensWith({ paused: true }, {}) }, 1));
    rerender(<App />);
    expect(play).toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it('si el navegador no deja empezar el video (macOS), le pide a Rust que lo reproduzca', async () => {
    const requestPlay = vi.fn().mockResolvedValue(undefined);
    useWallpaperStore.setState({ requestPlay });
    play.mockRejectedValue(new DOMException('no permitido', 'NotAllowedError'));
    show();

    await act(async () => {
      render(<App />);
    });

    expect(requestPlay).toHaveBeenCalledTimes(1);
  });

  it('si el navegador sí deja reproducir, no hace falta pedirle nada a Rust', async () => {
    const requestPlay = vi.fn().mockResolvedValue(undefined);
    useWallpaperStore.setState({ requestPlay });
    show();

    await act(async () => {
      render(<App />);
    });

    expect(play).toHaveBeenCalled();
    expect(requestPlay).not.toHaveBeenCalled();
  });

  it('en pausa no se pide reproducir nada', async () => {
    const requestPlay = vi.fn().mockResolvedValue(undefined);
    useWallpaperStore.setState({ requestPlay });
    play.mockRejectedValue(new DOMException('no permitido', 'NotAllowedError'));
    show({ manualPause: true });

    await act(async () => {
      render(<App />);
    });

    expect(requestPlay).not.toHaveBeenCalled();
  });
});
