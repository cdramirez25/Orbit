import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import { POLL_MS, pushSample } from '@/lib/system';
import type { SystemStats } from '@/types';

/** Si pasó más que esto desde la última lectura, el historial ya no continúa: se empieza de cero. */
const STALE_MS = 5000;

export type SystemStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Las últimas lecturas de lo que se dibuja como gráfica (la más nueva, al final). */
export interface SystemHistory {
  cpu: number[];
  down: number[];
  up: number[];
}

const EMPTY_HISTORY: SystemHistory = { cpu: [], down: [], up: [] };

interface SystemStore {
  stats: SystemStats | null;
  history: SystemHistory;
  status: SystemStatus;
  /** Código del último error (para elegir el mensaje); `null` si no hay. */
  errorCode: string | null;
  refresh: () => Promise<void>;
  /** Pide empezar a leer. Se cuentan los que lo piden: se lee mientras quede alguno. */
  start: () => void;
  stop: () => void;
}

let timer: ReturnType<typeof setInterval> | undefined;
let watchers = 0;
let reading = false;
let lastReadAt = 0;

export const useSystemStore = create<SystemStore>((set, get) => ({
  stats: null,
  history: EMPTY_HISTORY,
  status: 'idle',
  errorCode: null,

  refresh: async () => {
    if (reading) return; // la lectura anterior aún no termina
    reading = true;
    if (get().stats === null) set({ status: 'loading' });
    try {
      const stats = await commands.getSystemStats();
      lastReadAt = Date.now();
      set((s) => ({
        stats,
        status: 'ready',
        errorCode: null,
        history: {
          cpu: pushSample(s.history.cpu, stats.cpu.percent),
          down: pushSample(s.history.down, stats.network.downPerSec),
          up: pushSample(s.history.up, stats.network.upPerSec),
        },
      }));
    } catch (error) {
      set({ status: 'error', errorCode: commandErrorCode(error) ?? 'unknown' });
    } finally {
      reading = false;
    }
  },

  start: () => {
    watchers += 1;
    if (watchers > 1) return;
    if (Date.now() - lastReadAt > STALE_MS) set({ history: EMPTY_HISTORY });
    void get().refresh();
    timer = setInterval(() => void get().refresh(), POLL_MS);
  },

  stop: () => {
    watchers = Math.max(0, watchers - 1);
    if (watchers > 0) return;
    clearInterval(timer);
    timer = undefined;
  },
}));

/** Solo para las pruebas: deja el contador y el temporizador como al arrancar. */
export function resetSystemPolling(): void {
  clearInterval(timer);
  timer = undefined;
  watchers = 0;
  reading = false;
  lastReadAt = 0;
}
