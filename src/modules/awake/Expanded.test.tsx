import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { Expanded } from '@/modules/awake/Expanded';
import { useAwakeStore } from '@/stores/awake.store';
import type { KeepAwakeSetting, KeepAwakeStatus } from '@/types';

vi.mock('@/ipc/commands', () => ({
  commands: { keepAwakeStatus: vi.fn(), keepAwakeSet: vi.fn() },
}));

const mocked = vi.mocked(commands);

const status = (
  setting: KeepAwakeSetting,
  active = setting.mode !== 'off',
  error: string | null = null,
): KeepAwakeStatus => ({ setting, active, error });

const NOW = new Date(2026, 9, 22, 14, 0, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'es' });
  useAwakeStore.setState({
    status: status({ mode: 'off' }),
    errorCode: null,
    tab: 'duration',
    durationMinutes: 120,
    scheduleStart: 9 * 60,
    scheduleEnd: 17 * 60,
  });
  mocked.keepAwakeSet.mockImplementation((setting) => Promise.resolve(status(setting)));
});

afterEach(() => {
  vi.useRealTimers();
});

const click = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
  await act(async () => {});
};

describe('tarjeta de pantalla encendida', () => {
  it('desactivada: lo dice y no ofrece desactivar', () => {
    render(<Expanded />);
    expect(screen.getByText('La pantalla se apaga como siempre.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Desactivada');
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
  });

  it('con duración: elegir 4 horas y activar manda cuándo termina', async () => {
    render(<Expanded />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '240' } });
    await click('Activar');

    expect(mocked.keepAwakeSet).toHaveBeenCalledWith({
      mode: 'until',
      endsAt: NOW + 4 * 60 * 60_000,
    });
  });

  it('ofrece las duraciones con sus unidades', () => {
    render(<Expanded />);
    const options = within(screen.getByRole('combobox'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['30 min', '1 h', '2 h', '3 h', '4 h', '6 h', '8 h', '12 h']);
  });

  it('con un tiempo en marcha cuenta lo que falta cada segundo y se puede desactivar', async () => {
    useAwakeStore.setState({
      status: status({ mode: 'until', endsAt: NOW + 3 * 60 * 60_000 + 59 * 60_000 }),
    });
    render(<Expanded />);

    expect(screen.getByText('Quedan')).toBeInTheDocument();
    expect(screen.getByText('3:59:00')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Activa');

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText('3:58:55')).toBeInTheDocument();

    await click('Desactivar');
    expect(mocked.keepAwakeSet).toHaveBeenCalledWith({ mode: 'off' });
    expect(screen.getByText('La pantalla se apaga como siempre.')).toBeInTheDocument();
  });

  it('horario: elegir de 2 pm a 5 pm y activar lo manda en minutos', async () => {
    render(<Expanded />);
    fireEvent.click(screen.getByRole('tab', { name: 'Horario' }));
    const [from, to] = screen.getAllByRole('combobox');
    fireEvent.change(from!, { target: { value: '840' } });
    fireEvent.change(to!, { target: { value: '1020' } });
    expect(screen.getByText('Se repite todos los días.')).toBeInTheDocument();

    await click('Activar');

    expect(mocked.keepAwakeSet).toHaveBeenCalledWith({
      mode: 'schedule',
      start: 840,
      end: 1020,
    });
  });

  it('un horario en curso se muestra activo', () => {
    useAwakeStore.setState({ status: status({ mode: 'schedule', start: 840, end: 1020 }, true) });
    render(<Expanded />);
    expect(screen.getByText(/Todos los días/)).toBeInTheDocument();
    expect(screen.getByText('En horario')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Activa');
  });

  it('un horario que todavía no toca dice "Programada" y cuándo empieza, no "Desactivada"', () => {
    // Son las 14:00: uno que empieza a las 15:00 empieza hoy.
    useAwakeStore.setState({ status: status({ mode: 'schedule', start: 900, end: 1020 }, false) });
    const { unmount } = render(<Expanded />);
    expect(screen.getByRole('status')).toHaveTextContent('Programada');
    expect(screen.getByText(/Empieza hoy a las 3:00|Empieza hoy a las 15:00/)).toBeInTheDocument();
    // El horario sigue puesto aunque ahora no esté activo: se puede quitar.
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
    unmount();

    // Uno que ya pasó hoy (9:00 a 9:30) empieza mañana.
    useAwakeStore.setState({ status: status({ mode: 'schedule', start: 540, end: 570 }, false) });
    render(<Expanded />);
    expect(screen.getByRole('status')).toHaveTextContent('Programada');
    expect(screen.getByText(/Empieza mañana a las 9:00/)).toBeInTheDocument();
  });

  it('siempre: sin hora ni tiempo, hasta que se desactive', async () => {
    render(<Expanded />);
    fireEvent.click(screen.getByRole('tab', { name: 'Siempre' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.getByText('Se mantiene hasta que la desactives o apagues la computadora.'),
    ).toBeInTheDocument();

    await click('Activar');
    expect(mocked.keepAwakeSet).toHaveBeenCalledWith({ mode: 'always' });
    expect(screen.getByText('Siempre encendida, hasta que la desactives.')).toBeInTheDocument();

    await click('Desactivar');
    expect(mocked.keepAwakeSet).toHaveBeenLastCalledWith({ mode: 'off' });
  });

  it('un fallo se explica con un mensaje claro', async () => {
    mocked.keepAwakeSet.mockRejectedValue({ code: 'awake.invalidSchedule', message: 'x' });
    render(<Expanded />);
    fireEvent.click(screen.getByRole('tab', { name: 'Horario' }));
    await click('Activar');
    expect(screen.getByRole('alert')).toHaveTextContent('Elige dos horas distintas.');
  });

  it('un fallo del sistema que Rust avisó también se muestra', () => {
    useAwakeStore.setState({
      status: status({ mode: 'always' }, false, 'awake.system'),
    });
    render(<Expanded />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No se pudo mantener la pantalla encendida.',
    );
  });

  it('en inglés, los textos y las horas salen en inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<Expanded />);
    expect(screen.getByText('The screen turns off as usual.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Schedule' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
    expect(screen.getAllByRole('option', { name: /2:00\s?PM/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });
});
