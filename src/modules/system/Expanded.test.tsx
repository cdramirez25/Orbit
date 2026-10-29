import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { Expanded } from '@/modules/system/Expanded';
import { useSystemStore } from '@/stores/system.store';
import type { Battery, SystemStats } from '@/types';

const GIB = 1024 ** 3;

const laptopBattery: Battery = { percent: 82, state: 'discharging', minutesLeft: 410 };

const stats = (overrides: Partial<SystemStats> = {}): SystemStats => ({
  cpu: { percent: 53.4, cores: 10 },
  memory: { used: 17.6 * GIB, total: 24 * GIB },
  network: { downPerSec: 1.2 * 1024 ** 2, upPerSec: 340 * 1024 },
  battery: laptopBattery,
  ...overrides,
});

const start = vi.fn();
const stop = vi.fn();
const refresh = vi.fn().mockResolvedValue(undefined);

const history = (values: number[]) => ({ cpu: values, down: values, up: values });

function show(
  value: SystemStats | null,
  extra: Partial<ReturnType<typeof useSystemStore.getState>> = {},
) {
  useSystemStore.setState({
    stats: value,
    history: history(value ? [10, 20, 30, 40, 50] : []),
    status: value ? 'ready' : 'loading',
    errorCode: null,
    start,
    stop,
    refresh,
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'es' });
  show(stats());
});

describe('equipo expandido', () => {
  it('en un portátil muestra batería, CPU, memoria y red', () => {
    render(<Expanded />);

    const battery = screen.getByRole('region', { name: 'Batería' });
    expect(within(battery).getByText('82')).toBeInTheDocument();
    expect(within(battery).getByText('Con batería')).toBeInTheDocument();
    expect(within(battery).getByText('6 h 50 min')).toBeInTheDocument();
    expect(within(battery).getByText('restantes')).toBeInTheDocument();

    const cpu = screen.getByRole('region', { name: 'CPU' });
    expect(within(cpu).getByText('53')).toBeInTheDocument();
    expect(within(cpu).getByText('10 núcleos')).toBeInTheDocument();

    const memory = screen.getByRole('region', { name: 'Memoria' });
    expect(within(memory).getByText('73')).toBeInTheDocument();
    expect(within(memory).getByText('17,6 GB de 24,0 GB')).toBeInTheDocument();

    const network = screen.getByRole('region', { name: 'Red' });
    expect(within(network).getByText('1,2')).toBeInTheDocument();
    expect(within(network).getByText('MB/s')).toBeInTheDocument();
    expect(within(network).getByText('340')).toBeInTheDocument();
    expect(within(network).getByText('KB/s')).toBeInTheDocument();
  });

  it('en un equipo sin batería no hay tarjeta de batería y la red ocupa todo el ancho', () => {
    show(stats({ battery: null }));
    render(<Expanded />);

    expect(screen.queryByRole('region', { name: 'Batería' })).toBeNull();
    expect(screen.getByRole('region', { name: 'CPU' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Red' })).toHaveClass('col-span-2');
  });

  it('con batería la red comparte fila con la memoria', () => {
    render(<Expanded />);
    expect(screen.getByRole('region', { name: 'Red' })).not.toHaveClass('col-span-2');
  });

  it('los medidores de batería y memoria dicen cuánto llevan', () => {
    render(<Expanded />);
    expect(screen.getByRole('progressbar', { name: 'Batería' })).toHaveAttribute(
      'aria-valuenow',
      '82',
    );
    expect(screen.getByRole('progressbar', { name: 'Memoria' })).toHaveAttribute(
      'aria-valuenow',
      '73',
    );
  });

  it('cargando dice cuánto falta para llenarse; llena o sin cargar no da tiempo', () => {
    show(stats({ battery: { percent: 40, state: 'charging', minutesLeft: 35 } }));
    const { rerender } = render(<Expanded />);
    expect(screen.getByText('Cargando')).toBeInTheDocument();
    expect(screen.getByText('35 min')).toBeInTheDocument();
    expect(screen.getByText('para llenarse')).toBeInTheDocument();

    show(stats({ battery: { percent: 100, state: 'full', minutesLeft: null } }));
    rerender(<Expanded />);
    expect(screen.getByText('Carga completa')).toBeInTheDocument();
    expect(screen.queryByText('para llenarse')).toBeNull();

    show(stats({ battery: { percent: 80, state: 'pluggedIn', minutesLeft: null } }));
    rerender(<Expanded />);
    expect(screen.getByText('Conectada, sin cargar')).toBeInTheDocument();
  });

  it('si el sistema no sabe el tiempo no inventa uno', () => {
    show(stats({ battery: { percent: 60, state: 'discharging', minutesLeft: null } }));
    render(<Expanded />);
    expect(screen.queryByText('restantes')).toBeNull();
  });

  it('avisa con texto cuando la batería está baja o casi vacía', () => {
    show(stats({ battery: { percent: 15, state: 'discharging', minutesLeft: 40 } }));
    const { rerender } = render(<Expanded />);
    expect(screen.getByText('Batería baja')).toBeInTheDocument();

    show(stats({ battery: { percent: 6, state: 'discharging', minutesLeft: 12 } }));
    rerender(<Expanded />);
    expect(screen.getByText('Casi sin batería')).toBeInTheDocument();
  });

  it('no avisa si la batería está baja pero está cargando', () => {
    show(stats({ battery: { percent: 6, state: 'charging', minutesLeft: 90 } }));
    render(<Expanded />);
    expect(screen.queryByText('Casi sin batería')).toBeNull();
    expect(screen.queryByText('Batería baja')).toBeNull();
  });

  it('avisa con texto cuando la CPU o la memoria van muy cargadas', () => {
    show(
      stats({
        cpu: { percent: 96, cores: 10 },
        memory: { used: 20 * GIB, total: 24 * GIB },
      }),
    );
    render(<Expanded />);
    expect(
      within(screen.getByRole('region', { name: 'CPU' })).getByText('Crítico'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Memoria' })).getByText('Alto'),
    ).toBeInTheDocument();
  });

  it('con poca carga no hay avisos', () => {
    render(<Expanded />);
    expect(screen.queryByText('Alto')).toBeNull();
    expect(screen.queryByText('Crítico')).toBeNull();
  });

  it('lo que se lee en pantalla cambia con el idioma', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<Expanded />);

    expect(screen.getByRole('region', { name: 'Battery' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Memory' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Network' })).toBeInTheDocument();
    expect(screen.getByText('10 cores')).toBeInTheDocument();
    expect(screen.getByText('17.6 GB of 24.0 GB')).toBeInTheDocument();
    expect(screen.getByText('left')).toBeInTheDocument();
  });

  it('las gráficas se pueden leer sin verlas', () => {
    render(<Expanded />);
    expect(
      screen.getByRole('img', { name: /^CPU: 53%.*máximo del último minuto 50%/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /^Red: Descarga 1,2 MB\/s, Subida 340 KB\/s/ }),
    ).toBeInTheDocument();
  });

  it('al pasar el puntero por la gráfica muestra esa lectura y cuándo fue', () => {
    render(<Expanded />);
    const chart = screen.getByRole('img', { name: /^CPU:/ });
    chart.getBoundingClientRect = () => ({ left: 0, width: 104, top: 0, height: 40 }) as DOMRect;

    // Casi todo el ancho está sin lecturas (hay 5 de 60): solo la derecha las tiene.
    fireEvent.pointerMove(chart, { clientX: 2 });
    expect(screen.queryByText(/hace/)).toBeNull();

    const cpu = screen.getByRole('region', { name: 'CPU' });
    fireEvent.pointerMove(chart, { clientX: 98 - 2 * (92 / 59) });
    expect(within(cpu).getByText('30')).toBeInTheDocument();
    expect(within(cpu).getByText(/hace/)).toBeInTheDocument();

    fireEvent.pointerLeave(chart);
    expect(within(cpu).getByText('53')).toBeInTheDocument();
    expect(within(cpu).queryByText(/hace/)).toBeNull();
  });

  it('pide empezar a leer al aparecer y parar al irse', () => {
    const { unmount } = render(<Expanded />);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('mientras llega la primera lectura dice que está leyendo', () => {
    show(null);
    render(<Expanded />);
    expect(screen.getByText('Leyendo el equipo…')).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('si no se pudo leer ofrece reintentar', () => {
    show(null, { status: 'error', errorCode: 'system.read' });
    render(<Expanded />);
    expect(screen.getByText('No se pudo leer el estado del equipo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
