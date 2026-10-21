import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import type { WeatherReport } from '@/types';

/** Cada cuánto se pide el clima (Rust guarda la respuesta 10 minutos, así que no se abusa). */
const REFRESH_EVERY_MS = 10 * 60 * 1000;

export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WeatherStore {
  /** Último clima obtenido. Si una actualización falla se sigue mostrando éste. */
  report: WeatherReport | null;
  status: WeatherStatus;
  /** Código del último error (para elegir el mensaje); `null` si no hay. */
  errorCode: string | null;
  refresh: (force?: boolean) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

let timer: ReturnType<typeof setInterval> | undefined;

export const useWeatherStore = create<WeatherStore>((set, get) => ({
  report: null,
  status: 'idle',
  errorCode: null,

  refresh: async (force = false) => {
    if (get().status === 'loading') return; // ya hay una petición en curso
    set({ status: 'loading' });
    try {
      const report = await commands.getWeather(force);
      set({ report, status: 'ready', errorCode: null });
    } catch (error) {
      set({ status: 'error', errorCode: commandErrorCode(error) ?? 'unknown' });
    }
  },

  startPolling: () => {
    if (timer !== undefined) return;
    void get().refresh(false);
    timer = setInterval(() => void get().refresh(false), REFRESH_EVERY_MS);
  },

  stopPolling: () => {
    clearInterval(timer);
    timer = undefined;
  },
}));
