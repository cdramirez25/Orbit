import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { HISTORY_LENGTH, POLL_MS } from '@/lib/system';
import { resetSystemPolling, useSystemStore } from '@/stores/system.store';
import type { SystemStats } from '@/types';

vi.mock('@/ipc/commands', () => ({ commands: { getSystemStats: vi.fn() } }));

const mocked = vi.mocked(commands);

const stats = (cpu = 10, down = 1000, up = 200): SystemStats => ({
  cpu: { percent: cpu, cores: 8 },
  memory: { used: 4, total: 16 },
  network: { downPerSec: down, upPerSec: up },
  battery: null,
});

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetSystemPolling();
  useSystemStore.setState({
    stats: null,
    history: { cpu: [], down: [], up: [] },
    status: 'idle',
    errorCode: null,
  });
});

afterEach(() => {
  resetSystemPolling();
  vi.useRealTimers();
});

describe('system.store', () => {
  it('al empezar lee de inmediato y guarda el estado y la primera lectura de las gráficas', async () => {
    mocked.getSystemStats.mockResolvedValue(stats(42, 5000, 700));
    useSystemStore.getState().start();
    await flush();

    const state = useSystemStore.getState();
    expect(state.status).toBe('ready');
    expect(state.stats?.cpu.percent).toBe(42);
    expect(state.history).toEqual({ cpu: [42], down: [5000], up: [700] });
  });

  it('sigue leyendo cada segundo y añade cada lectura al historial', async () => {
    mocked.getSystemStats.mockResolvedValue(stats());
    useSystemStore.getState().start();
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(mocked.getSystemStats).toHaveBeenCalledTimes(4);
    expect(useSystemStore.getState().history.cpu).toHaveLength(4);
  });

  it('el historial se queda en un minuto de lecturas', async () => {
    mocked.getSystemStats.mockResolvedValue(stats());
    useSystemStore.getState().start();
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_MS * (HISTORY_LENGTH + 20));

    expect(useSystemStore.getState().history.cpu).toHaveLength(HISTORY_LENGTH);
  });

  it('mientras alguien lo pida se sigue leyendo, y al irse el último se para', async () => {
    mocked.getSystemStats.mockResolvedValue(stats());
    const { start, stop } = useSystemStore.getState();
    start();
    start();
    await flush();
    mocked.getSystemStats.mockClear();

    stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(mocked.getSystemStats).toHaveBeenCalledTimes(2);

    stop();
    mocked.getSystemStats.mockClear();
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(mocked.getSystemStats).not.toHaveBeenCalled();
  });

  it('no empieza otra lectura si la anterior no ha terminado', async () => {
    let finish: (value: SystemStats) => void = () => undefined;
    mocked.getSystemStats.mockImplementation(
      () => new Promise<SystemStats>((resolve) => (finish = resolve)),
    );
    useSystemStore.getState().start();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(mocked.getSystemStats).toHaveBeenCalledTimes(1);

    finish(stats());
    await flush();
    expect(useSystemStore.getState().status).toBe('ready');
  });

  it('si una lectura falla se guarda el código, y se sigue mostrando lo último que se leyó', async () => {
    mocked.getSystemStats.mockResolvedValueOnce(stats(30));
    useSystemStore.getState().start();
    await flush();

    mocked.getSystemStats.mockRejectedValueOnce({ code: 'system.read', message: 'x' });
    await vi.advanceTimersByTimeAsync(POLL_MS);

    const state = useSystemStore.getState();
    expect(state.status).toBe('error');
    expect(state.errorCode).toBe('system.read');
    expect(state.stats?.cpu.percent).toBe(30);

    mocked.getSystemStats.mockResolvedValueOnce(stats(31));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useSystemStore.getState().status).toBe('ready');
    expect(useSystemStore.getState().errorCode).toBeNull();
  });

  it('al volver después de un rato largo las gráficas empiezan de cero', async () => {
    mocked.getSystemStats.mockResolvedValue(stats());
    const { start, stop } = useSystemStore.getState();
    start();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    stop();
    expect(useSystemStore.getState().history.cpu.length).toBeGreaterThan(2);

    await vi.advanceTimersByTimeAsync(60_000);
    start();
    expect(useSystemStore.getState().history.cpu).toEqual([]);
    await flush();
    expect(useSystemStore.getState().history.cpu).toHaveLength(1);
  });

  it('al volver enseguida las gráficas siguen donde estaban', async () => {
    mocked.getSystemStats.mockResolvedValue(stats());
    const { start, stop } = useSystemStore.getState();
    start();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    stop();
    const before = useSystemStore.getState().history.cpu.length;

    await vi.advanceTimersByTimeAsync(1000);
    start();
    await flush();
    expect(useSystemStore.getState().history.cpu.length).toBe(before + 1);
  });
});
