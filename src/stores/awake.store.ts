import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import { onEvent } from '@/ipc/events';
import { DEFAULT_DURATION_MINUTES, DEFAULT_SCHEDULE } from '@/lib/awake';
import type { KeepAwakeSetting, KeepAwakeStatus } from '@/types';

/** Qué modo se está preparando en la tarjeta (no es el modo activo: ese está en `status`). */
export type AwakeTab = 'duration' | 'schedule' | 'always';

const MINUTE_MS = 60_000;

interface AwakeStore {
  /** Lo que Rust dice: el modo activo y si se está manteniendo; `null` = todavía no se ha consultado. */
  status: KeepAwakeStatus | null;
  /** Código del último fallo de una orden (`awake.*`); `null` si no hubo. */
  errorCode: string | null;
  /** El borrador de la tarjeta: qué pestaña y con qué valores se activaría. */
  tab: AwakeTab;
  durationMinutes: number;
  scheduleStart: number;
  scheduleEnd: number;
  setTab: (tab: AwakeTab) => void;
  setDurationMinutes: (minutes: number) => void;
  setScheduleStart: (minute: number) => void;
  setScheduleEnd: (minute: number) => void;
  /** Activa el modo de la pestaña actual con los valores del borrador. */
  start: () => Promise<void>;
  /** Desactiva la pantalla encendida (la pantalla vuelve a apagarse como siempre). */
  stop: () => Promise<void>;
  /** Pide el estado y se suscribe a sus cambios (se acabó el tiempo, empezó el horario…). */
  bind: () => Promise<() => void>;
}

export const useAwakeStore = create<AwakeStore>((set, get) => {
  const apply = async (setting: KeepAwakeSetting) => {
    set({ errorCode: null });
    try {
      set({ status: await commands.keepAwakeSet(setting) });
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    }
  };

  return {
    status: null,
    errorCode: null,
    tab: 'duration',
    durationMinutes: DEFAULT_DURATION_MINUTES,
    scheduleStart: DEFAULT_SCHEDULE.start,
    scheduleEnd: DEFAULT_SCHEDULE.end,

    setTab: (tab) => set({ tab, errorCode: null }),
    setDurationMinutes: (durationMinutes) => set({ durationMinutes }),
    setScheduleStart: (scheduleStart) => set({ scheduleStart, errorCode: null }),
    setScheduleEnd: (scheduleEnd) => set({ scheduleEnd, errorCode: null }),

    start: () => {
      const { tab, durationMinutes, scheduleStart, scheduleEnd } = get();
      switch (tab) {
        case 'duration':
          return apply({ mode: 'until', endsAt: Date.now() + durationMinutes * MINUTE_MS });
        case 'schedule':
          return apply({ mode: 'schedule', start: scheduleStart, end: scheduleEnd });
        case 'always':
          return apply({ mode: 'always' });
      }
    },

    stop: () => apply({ mode: 'off' }),

    bind: async () => {
      const off = await onEvent('awake:changed', (status) => set({ status }));
      try {
        set({ status: await commands.keepAwakeStatus() });
      } catch {
        // Sin estado se queda en `null`: la tarjeta lo muestra como desactivado.
      }
      return off;
    },
  };
});
