import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { Compact } from '@/modules/system/Compact';
import { useSystemStore } from '@/stores/system.store';
import type { SystemStats } from '@/types';

const GIB = 1024 ** 3;

const stats = (overrides: Partial<SystemStats> = {}): SystemStats => ({
  cpu: { percent: 7.4, cores: 10 },
  memory: { used: 12 * GIB, total: 24 * GIB },
  network: { downPerSec: 0, upPerSec: 0 },
  battery: { percent: 82, state: 'discharging', minutesLeft: 410 },
  ...overrides,
});

const start = vi.fn();
const stop = vi.fn();

function show(value: SystemStats | null) {
  useSystemStore.setState({
    stats: value,
    history: { cpu: [], down: [], up: [] },
    status: value ? 'ready' : 'loading',
    errorCode: null,
    start,
    stop,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'es' });
  show(stats());
});

describe('equipo compacto', () => {
  it('en un portátil muestra la batería y la CPU', () => {
    render(<Compact />);
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('7%')).toBeInTheDocument();
    expect(screen.getByText('Batería')).toHaveClass('sr-only');
    expect(screen.getByText('CPU')).toHaveClass('sr-only');
  });

  it('en un equipo de escritorio muestra la memoria en vez de la batería', () => {
    show(stats({ battery: null }));
    render(<Compact />);
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Memoria')).toHaveClass('sr-only');
    expect(screen.queryByText('Batería')).toBeNull();
  });

  it('antes de la primera lectura muestra guiones', () => {
    show(null);
    render(<Compact />);
    expect(screen.getAllByText('--')).toHaveLength(2);
  });

  it('la batería baja se pinta con el color de aviso', () => {
    show(stats({ battery: { percent: 15, state: 'discharging', minutesLeft: 30 } }));
    const { container } = render(<Compact />);
    expect(container.querySelector('svg')).toHaveClass('text-warning');
  });

  it('la batería casi vacía se pinta con el color de peligro', () => {
    show(stats({ battery: { percent: 5, state: 'discharging', minutesLeft: 8 } }));
    const { container } = render(<Compact />);
    expect(container.querySelector('svg')).toHaveClass('text-danger');
  });

  it('pide leer mientras está a la vista y deja de pedirlo al irse', () => {
    const { unmount } = render(<Compact />);
    expect(start).toHaveBeenCalledTimes(1);
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
