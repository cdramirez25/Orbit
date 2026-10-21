import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useWeatherStore } from '@/stores/weather.store';
import type { WeatherReport } from '@/types';

vi.mock('@/ipc/commands', () => ({ commands: { getWeather: vi.fn() } }));

const mocked = vi.mocked(commands);

const report: WeatherReport = {
  location: { name: 'City', country: 'Land', countryCode: 'LA', latitude: 1, longitude: 2 },
  units: 'metric',
  current: {
    temperature: 20,
    apparentTemperature: 19,
    humidity: 50,
    windSpeed: 10,
    weatherCode: 0,
    isDay: true,
  },
  today: { temperatureMax: 25, temperatureMin: 15, precipitationProbability: null },
  fetchedAtMs: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useWeatherStore.getState().stopPolling();
  useWeatherStore.setState({ report: null, status: 'idle', errorCode: null });
});

afterEach(() => {
  useWeatherStore.getState().stopPolling();
  vi.useRealTimers();
});

describe('weather.store', () => {
  it('refresh guarda el clima y queda listo', async () => {
    mocked.getWeather.mockResolvedValue(report);
    await useWeatherStore.getState().refresh();
    expect(useWeatherStore.getState()).toMatchObject({ status: 'ready', report, errorCode: null });
  });

  it('refresh(true) fuerza la consulta', async () => {
    mocked.getWeather.mockResolvedValue(report);
    await useWeatherStore.getState().refresh(true);
    expect(mocked.getWeather).toHaveBeenCalledWith(true);
  });

  it('un error guarda su código y conserva el último clima', async () => {
    useWeatherStore.setState({ report, status: 'ready' });
    mocked.getWeather.mockRejectedValue({ code: 'weather.network', message: 'x' });
    await useWeatherStore.getState().refresh();
    expect(useWeatherStore.getState()).toMatchObject({
      status: 'error',
      errorCode: 'weather.network',
      report,
    });
  });

  it('un error sin código queda como desconocido', async () => {
    mocked.getWeather.mockRejectedValue(new Error('boom'));
    await useWeatherStore.getState().refresh();
    expect(useWeatherStore.getState().errorCode).toBe('unknown');
  });

  it('no lanza una segunda petición mientras hay una en curso', async () => {
    mocked.getWeather.mockResolvedValue(report);
    const first = useWeatherStore.getState().refresh();
    await useWeatherStore.getState().refresh();
    await first;
    expect(mocked.getWeather).toHaveBeenCalledTimes(1);
  });

  it('startPolling consulta al empezar y cada 10 minutos, y stopPolling lo detiene', async () => {
    mocked.getWeather.mockResolvedValue(report);
    useWeatherStore.getState().startPolling();
    useWeatherStore.getState().startPolling(); // no duplica el temporizador
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.getWeather).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(mocked.getWeather).toHaveBeenCalledTimes(2);

    useWeatherStore.getState().stopPolling();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(mocked.getWeather).toHaveBeenCalledTimes(2);
  });
});
