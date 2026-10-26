import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWallpaperStore } from '@/stores/wallpaper.store';
import { App } from '@/windows/wallpaper/App';
import type { WallpaperStatus } from '@/types';

vi.mock('@/ipc/commands', () => ({ commands: {} }));

const status = (overrides: Partial<WallpaperStatus> = {}): WallpaperStatus => ({
  enabled: true,
  file: 'mar.mp4',
  kind: 'video',
  path: '/x/mar.mp4',
  manualPause: false,
  performance: 'any',
  screenPaused: [false, false],
  missing: false,
  folder: '/x',
  error: null,
  ...overrides,
});

function show(overrides: Partial<WallpaperStatus> = {}, screen = 0) {
  useWallpaperStore.setState({
    status: status(overrides),
    url: overrides.path === null ? null : 'asset://localhost/x/mar.mp4',
    screen,
  });
}

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

    act(() => show({ kind: null, path: null }));
    rerender(<App />);
    expect(container.querySelector('video, img')).toBeNull();
  });

  it('una imagen se dibuja a pantalla completa', () => {
    show({ kind: 'image', path: '/x/montana.png' });
    useWallpaperStore.setState({ url: 'asset://localhost/x/montana.png' });
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
    show({ screenPaused: [false, true] }, 1);
    const { rerender } = render(<App />);
    expect(pause).toHaveBeenCalled();

    pause.mockClear();
    play.mockClear();
    act(() => show({ screenPaused: [true, false] }, 1));
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
