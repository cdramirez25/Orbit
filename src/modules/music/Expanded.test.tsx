import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { Compact } from '@/modules/music/Compact';
import { Expanded } from '@/modules/music/Expanded';
import { useMediaStore } from '@/stores/media.store';

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
  useMediaStore.setState({
    nowPlaying: { title: 'Canción de prueba', artist: 'Artista de prueba', playing: true },
  });
});

describe('música expandida', () => {
  it('muestra el título, el artista y que está sonando', () => {
    render(<Expanded />);
    expect(screen.getByText('Canción de prueba')).toBeInTheDocument();
    expect(screen.getByText('Artista de prueba')).toBeInTheDocument();
    expect(screen.getByText('Sonando')).toBeInTheDocument();
  });

  it('sin artista no deja un hueco', () => {
    useMediaStore.setState({ nowPlaying: { title: 'Solo título', artist: null, playing: true } });
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

describe('música en la pastilla', () => {
  it('solo muestra iconos (sin el título)', () => {
    const { container } = render(<Compact />);
    expect(container.querySelectorAll('svg').length).toBe(2);
    expect(screen.queryByText('Canción de prueba')).not.toBeInTheDocument();
  });

  it('sin nada sonando solo queda la nota', () => {
    useMediaStore.setState({ nowPlaying: null });
    const { container } = render(<Compact />);
    expect(container.querySelectorAll('svg').length).toBe(1);
  });
});
