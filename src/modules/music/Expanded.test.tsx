import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { Compact } from '@/modules/music/Compact';
import { Expanded } from '@/modules/music/Expanded';
import { useMediaStore } from '@/stores/media.store';
import { nowPlaying } from '@/test/factories';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getNowPlaying: vi.fn(),
    sendMediaCommand: vi.fn().mockResolvedValue(undefined),
  },
}));

const mocked = vi.mocked(commands);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.sendMediaCommand.mockResolvedValue();
  useLocaleStore.setState({ locale: 'es' });
  useMediaStore.setState({ nowPlaying: nowPlaying() });
});

describe('música expandida', () => {
  it('muestra el título, el artista y que está sonando', () => {
    render(<Expanded />);
    expect(screen.getByText('Canción de prueba')).toBeInTheDocument();
    expect(screen.getByText('Artista de prueba')).toBeInTheDocument();
    expect(screen.getByText('Sonando')).toBeInTheDocument();
  });

  it('sin artista no deja un hueco', () => {
    useMediaStore.setState({ nowPlaying: nowPlaying({ title: 'Solo título', artist: null }) });
    render(<Expanded />);
    expect(screen.getByText('Solo título')).toBeInTheDocument();
    expect(screen.queryByText('Artista de prueba')).not.toBeInTheDocument();
  });

  it('el botón central pausa lo que suena', () => {
    render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    expect(mocked.sendMediaCommand).toHaveBeenCalledWith('toggle');
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeInTheDocument();
    expect(screen.getByText('En pausa')).toBeInTheDocument();
  });

  it('anterior y siguiente mandan su orden', () => {
    render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(mocked.sendMediaCommand).toHaveBeenLastCalledWith('previous');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(mocked.sendMediaCommand).toHaveBeenLastCalledWith('next');
  });

  it('si no suena nada lo dice y no ofrece controles', () => {
    useMediaStore.setState({ nowPlaying: null });
    render(<Expanded />);
    expect(screen.getByText('No suena nada ahora mismo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument();
  });

  it('se traduce al inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<Expanded />);
    expect(screen.getByText('Now playing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Music controls' })).toBeInTheDocument();
  });
});

describe('portada y barra de progreso', () => {
  const withBar = (overrides = {}) =>
    nowPlaying({ duration: 200, position: 50, positionAtMs: Date.now(), ...overrides });

  it('muestra la portada si la hay y una nota musical si no', () => {
    useMediaStore.setState({ nowPlaying: withBar({ artwork: 'data:image/png;base64,AAAA' }) });
    const { container, unmount } = render(<Expanded />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    unmount();

    useMediaStore.setState({ nowPlaying: withBar({ artwork: null }) });
    const second = render(<Expanded />);
    expect(second.container.querySelector('img')).toBeNull();
  });

  it('muestra el tiempo reproducido, la duración y la barra', () => {
    useMediaStore.setState({ nowPlaying: withBar() });
    render(<Expanded />);
    expect(screen.getByText('0:50')).toBeInTheDocument();
    expect(screen.getByText('3:20')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Progreso de la canción' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemax', '200');
  });

  it('avanza sola mientras suena y se queda quieta en pausa', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    useMediaStore.setState({ nowPlaying: withBar({ positionAtMs: Date.now() }) });
    const { unmount } = render(<Expanded />);
    expect(screen.getByText('0:50')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('1:20')).toBeInTheDocument();
    unmount();

    useMediaStore.setState({ nowPlaying: withBar({ playing: false, positionAtMs: Date.now() }) });
    render(<Expanded />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('0:50')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('en un directo (sin duración) no hay barra', () => {
    useMediaStore.setState({ nowPlaying: nowPlaying({ duration: null }) });
    render(<Expanded />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('la barra se traduce al inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    useMediaStore.setState({ nowPlaying: withBar() });
    render(<Expanded />);
    expect(screen.getByRole('progressbar', { name: 'Song progress' })).toBeInTheDocument();
  });
});

describe('música en la pastilla', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it('solo muestra iconos y ondas (sin el título)', () => {
    const { container } = render(<Compact />);
    expect(screen.queryByText('Canción de prueba')).not.toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(1); // la nota
    expect(container.querySelectorAll('span[aria-hidden="true"].bg-accent')).toHaveLength(4);
  });

  it('en pausa las ondas se apagan y sale el icono de pausa', () => {
    useMediaStore.setState({ nowPlaying: nowPlaying({ playing: false }) });
    const { container } = render(<Compact />);
    expect(container.querySelectorAll('span[aria-hidden="true"].bg-accent')).toHaveLength(0);
    expect(container.querySelectorAll('svg')).toHaveLength(2); // la nota y la pausa
  });

  it('sin nada sonando solo queda la nota', () => {
    useMediaStore.setState({ nowPlaying: null });
    const { container } = render(<Compact />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelectorAll('span[aria-hidden="true"].bg-accent')).toHaveLength(0);
  });
});
