import { create } from 'zustand';

import { commands } from '@/ipc/commands';

interface AutostartStore {
  /** ¿Orbit se abre solo al iniciar sesión? `null` = todavía no se ha consultado. */
  enabled: boolean | null;
  /** El último cambio falló (el sistema no dejó escribir el inicio automático). */
  failed: boolean;
  load: () => Promise<void>;
  set: (enabled: boolean) => Promise<void>;
}

export const useAutostartStore = create<AutostartStore>((set) => ({
  enabled: null,
  failed: false,

  load: async () => {
    try {
      set({ enabled: await commands.getAutostart() });
    } catch {
      // Sin respuesta del sistema el interruptor no se muestra.
    }
  },

  set: async (enabled) => {
    set({ failed: false });
    try {
      set({ enabled: await commands.setAutostart(enabled) });
    } catch {
      set({ failed: true });
    }
  },
}));
