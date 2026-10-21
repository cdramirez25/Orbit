import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { Expanded } from '@/modules/music/Expanded';
import { useMediaStore } from '@/stores/media.store';
import { nowPlaying } from '@/test/factories';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getNowPlaying: vi.fn(),
    sendMediaCommand: vi.fn().mockResolvedValue(undefined),
    seekMedia: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

/** jsdom no trae PointerEvent: se imita con lo que usa la barra (posición y número de puntero). */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

/** Canción pausada de 200 s, en el segundo 50 (pausada: la posición no avanza sola). */
const song = () =>
  nowPlaying({ playing: false, duration: 200, position: 50, positionAtMs: Date.now() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  Element.prototype.setPointerCapture = vi.fn();
  // La barra mide 200 px y empieza en x = 100.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 300,
    width: 200,
    top: 0,
    bottom: 4,
    height: 4,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  mocked.seekMedia.mockResolvedValue();
  useLocaleStore.setState({ locale: 'es' });
  useMediaStore.setState({ nowPlaying: song() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const slider = () => screen.getByRole('slider', { name: 'Progreso de la canción' });

describe('barra de progreso de la música', () => {
  it('es un control deslizante con la posición y la duración', () => {
    render(<Expanded />);
    expect(slider()).toHaveAttribute('aria-valuenow', '50');
    expect(slider()).toHaveAttribute('aria-valuemax', '200');
    expect(slider()).toHaveAttribute('aria-valuetext', '0:50 / 3:20');
  });

  it('sin duración (un directo) no hay barra', () => {
    useMediaStore.setState({ nowPlaying: nowPlaying({ duration: null }) });
    render(<Expanded />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('pulsar en la mitad salta a la mitad de la canción', () => {
    render(<Expanded />);
    fireEvent.pointerDown(slider(), { clientX: 200, button: 0 });
    fireEvent.pointerUp(slider(), { clientX: 200, button: 0 });

    expect(mocked.seekMedia).toHaveBeenCalledTimes(1);
    expect(mocked.seekMedia).toHaveBeenCalledWith(100);
  });

  it('arrastrando muestra el tiempo al que va y solo salta al soltar', () => {
    render(<Expanded />);
    fireEvent.pointerDown(slider(), { clientX: 100, button: 0 });
    fireEvent.pointerMove(slider(), { clientX: 250 }); // 75 % de 200 s

    expect(screen.getByText('2:30')).toBeInTheDocument();
    expect(slider()).toHaveAttribute('aria-valuenow', '150');
    expect(mocked.seekMedia).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider(), { clientX: 250 });
    expect(mocked.seekMedia).toHaveBeenCalledTimes(1);
    expect(mocked.seekMedia).toHaveBeenCalledWith(150);
  });

  it('soltar fuera de la barra se queda en el extremo más cercano', () => {
    render(<Expanded />);
    fireEvent.pointerDown(slider(), { clientX: 150, button: 0 });
    fireEvent.pointerUp(slider(), { clientX: 5_000 });
    expect(mocked.seekMedia).toHaveBeenLastCalledWith(200);

    fireEvent.pointerDown(slider(), { clientX: 150, button: 0 });
    fireEvent.pointerUp(slider(), { clientX: -5_000 });
    expect(mocked.seekMedia).toHaveBeenLastCalledWith(0);
  });

  it('solo se arrastra con el botón principal del ratón', () => {
    render(<Expanded />);
    fireEvent.pointerDown(slider(), { clientX: 200, button: 2 });
    fireEvent.pointerUp(slider(), { clientX: 200, button: 2 });
    expect(mocked.seekMedia).not.toHaveBeenCalled();
  });

  it('cancelar el gesto no salta a ningún lado', () => {
    render(<Expanded />);
    fireEvent.pointerDown(slider(), { clientX: 250, button: 0 });
    fireEvent.pointerCancel(slider());
    fireEvent.pointerUp(slider(), { clientX: 250 });
    expect(mocked.seekMedia).not.toHaveBeenCalled();
  });

  it('con el teclado: las flechas saltan 5 s, Re Pág / Av Pág 15 s y Inicio vuelve al principio', () => {
    render(<Expanded />);

    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    expect(mocked.seekMedia).toHaveBeenLastCalledWith(55);
    fireEvent.keyDown(slider(), { key: 'ArrowLeft' });
    expect(mocked.seekMedia).toHaveBeenLastCalledWith(50);
    fireEvent.keyDown(slider(), { key: 'PageUp' });
    expect(mocked.seekMedia).toHaveBeenLastCalledWith(65);
    fireEvent.keyDown(slider(), { key: 'PageDown' });
    expect(mocked.seekMedia).toHaveBeenLastCalledWith(50);
    fireEvent.keyDown(slider(), { key: 'Home' });
    expect(mocked.seekMedia).toHaveBeenLastCalledWith(0);
  });

  it('otras teclas no hacen nada', () => {
    render(<Expanded />);
    fireEvent.keyDown(slider(), { key: 'a' });
    fireEvent.keyDown(slider(), { key: 'Tab' });
    expect(mocked.seekMedia).not.toHaveBeenCalled();
  });

  it('si el reproductor no deja saltar, la barra vuelve a donde estaba', async () => {
    mocked.seekMedia.mockRejectedValue({ code: 'media.notSeekable', message: 'no' });
    mocked.getNowPlaying.mockResolvedValue(song());
    render(<Expanded />);

    fireEvent.pointerDown(slider(), { clientX: 280, button: 0 });
    fireEvent.pointerUp(slider(), { clientX: 280 });
    await vi.waitFor(() => expect(mocked.getNowPlaying).toHaveBeenCalled());

    await vi.waitFor(() => expect(slider()).toHaveAttribute('aria-valuenow', '50'));
  });

  it('se puede usar con el teclado: recibe el foco', () => {
    render(<Expanded />);
    expect(slider()).toHaveAttribute('tabindex', '0');
  });
});
