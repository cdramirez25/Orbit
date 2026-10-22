import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { Compact } from '@/modules/awake/Compact';
import { awakeModule } from '@/modules/awake';
import { useAwakeStore } from '@/stores/awake.store';
import type { KeepAwakeSetting } from '@/types';

const NOW = new Date(2026, 9, 22, 14, 0, 0).getTime();

const setStatus = (setting: KeepAwakeSetting, active: boolean) =>
  useAwakeStore.setState({ status: { setting, active, error: null } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useLocaleStore.setState({ locale: 'es' });
  useAwakeStore.setState({ status: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pastilla de pantalla encendida', () => {
  it('sin nada puesto no muestra tiempo y se anuncia como desactivada', () => {
    setStatus({ mode: 'off' }, false);
    render(<Compact />);
    expect(screen.getByText('Desactivada')).toBeInTheDocument();
    expect(screen.queryByText(/:/)).not.toBeInTheDocument();
  });

  it('con un tiempo en marcha cuenta lo que falta', () => {
    setStatus({ mode: 'until', endsAt: NOW + 59 * 60_000 + 30_000 }, true);
    render(<Compact />);
    expect(screen.getByText('Activa')).toBeInTheDocument();
    expect(screen.getByText('59:30')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('59:00')).toBeInTheDocument();
  });

  it('siempre y horario no cuentan nada: solo su icono', () => {
    setStatus({ mode: 'always' }, true);
    const { container, unmount } = render(<Compact />);
    expect(screen.getByText('Activa')).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(2); // taza + infinito
    unmount();

    setStatus({ mode: 'schedule', start: 840, end: 1020 }, false);
    const second = render(<Compact />);
    expect(screen.getByText('Programada')).toBeInTheDocument();
    expect(second.container.querySelectorAll('svg')).toHaveLength(2); // taza + calendario
  });

  it('es un módulo residente de la isla con su propio nombre', () => {
    expect(awakeModule.ambient).toBe(true);
    expect(awakeModule.labelKey).toBe('awake.module');
  });
});
