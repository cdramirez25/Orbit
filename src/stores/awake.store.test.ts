import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useAwakeStore } from '@/stores/awake.store';
import type { KeepAwakeSetting, KeepAwakeStatus } from '@/types';

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());

vi.mock('@/ipc/events', () => ({
  onEvent: vi.fn((name: string, handler: (payload: unknown) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));

vi.mock('@/ipc/commands', () => ({
  commands: { keepAwakeStatus: vi.fn(), keepAwakeSet: vi.fn() },
}));

const mocked = vi.mocked(commands);

const status = (setting: KeepAwakeSetting, active = true): KeepAwakeStatus => ({
  setting,
  active,
  error: null,
});

const NOW = new Date(2026, 9, 22, 14, 0, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  handlers.clear();
  useAwakeStore.setState({
    status: null,
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

describe('pantalla encendida', () => {
  it('al enlazar pide el estado y sigue los cambios que avisa Rust', async () => {
    mocked.keepAwakeStatus.mockResolvedValue(status({ mode: 'always' }));
    await useAwakeStore.getState().bind();
    expect(useAwakeStore.getState().status).toEqual(status({ mode: 'always' }));

    // Se acabó el tiempo: Rust lo apaga solo y lo avisa.
    handlers.get('awake:changed')?.(status({ mode: 'off' }, false));
    expect(useAwakeStore.getState().status?.setting).toEqual({ mode: 'off' });
    expect(useAwakeStore.getState().status?.active).toBe(false);
  });

  it('si no se puede consultar el estado, se queda sin él', async () => {
    mocked.keepAwakeStatus.mockRejectedValue(new Error('sin respuesta'));
    await useAwakeStore.getState().bind();
    expect(useAwakeStore.getState().status).toBeNull();
  });

  it('activar una duración manda la hora exacta en que termina', async () => {
    useAwakeStore.getState().setDurationMinutes(240);
    await useAwakeStore.getState().start();

    expect(mocked.keepAwakeSet).toHaveBeenCalledWith({
      mode: 'until',
      endsAt: NOW + 4 * 60 * 60_000,
    });
    expect(useAwakeStore.getState().status?.setting.mode).toBe('until');
  });

  it('activar un horario manda de qué hora a qué hora', async () => {
    useAwakeStore.getState().setTab('schedule');
    useAwakeStore.getState().setScheduleStart(14 * 60);
    useAwakeStore.getState().setScheduleEnd(17 * 60);
    await useAwakeStore.getState().start();

    expect(mocked.keepAwakeSet).toHaveBeenCalledWith({
      mode: 'schedule',
      start: 840,
      end: 1020,
    });
  });

  it('activar siempre no lleva hora ni tiempo', async () => {
    useAwakeStore.getState().setTab('always');
    await useAwakeStore.getState().start();
    expect(mocked.keepAwakeSet).toHaveBeenCalledWith({ mode: 'always' });
  });

  it('desactivar apaga el modo y deja el borrador como estaba', async () => {
    useAwakeStore.getState().setDurationMinutes(480);
    await useAwakeStore.getState().stop();

    expect(mocked.keepAwakeSet).toHaveBeenCalledWith({ mode: 'off' });
    expect(useAwakeStore.getState().status?.setting).toEqual({ mode: 'off' });
    expect(useAwakeStore.getState().durationMinutes).toBe(480);
  });

  it('un fallo de Rust guarda su código y no cambia el estado', async () => {
    useAwakeStore.setState({ status: status({ mode: 'always' }) });
    mocked.keepAwakeSet.mockRejectedValue({ code: 'awake.invalidSchedule', message: 'x' });
    useAwakeStore.getState().setTab('schedule');

    await useAwakeStore.getState().start();

    expect(useAwakeStore.getState().errorCode).toBe('awake.invalidSchedule');
    expect(useAwakeStore.getState().status?.setting).toEqual({ mode: 'always' });
  });

  it('un error sin código se guarda como desconocido y el siguiente intento lo limpia', async () => {
    mocked.keepAwakeSet.mockRejectedValueOnce(new Error('x'));
    await useAwakeStore.getState().start();
    expect(useAwakeStore.getState().errorCode).toBe('unknown');

    await useAwakeStore.getState().start();
    expect(useAwakeStore.getState().errorCode).toBeNull();
  });

  it('cambiar de pestaña o de hora limpia el aviso anterior', () => {
    useAwakeStore.setState({ errorCode: 'awake.invalidSchedule' });
    useAwakeStore.getState().setScheduleEnd(18 * 60);
    expect(useAwakeStore.getState().errorCode).toBeNull();

    useAwakeStore.setState({ errorCode: 'awake.system' });
    useAwakeStore.getState().setTab('always');
    expect(useAwakeStore.getState().errorCode).toBeNull();
  });
});
