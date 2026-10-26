import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import type { SoundOutputDevice } from '@/types';

interface SoundOutputStore {
  /** Las salidas de sonido conectadas; vacío = todavía no se han leído o no hay ninguna. */
  devices: SoundOutputDevice[];
  /** Código del último fallo (`soundOutput.*`); `null` si no hubo. */
  errorCode: string | null;
  /** Se está cambiando de salida. */
  switching: boolean;
  /** Vuelve a leer las salidas (por si se conectaron o quitaron unos audífonos). */
  refresh: () => Promise<void>;
  /** Hace que el sistema use esa salida. */
  choose: (id: string) => Promise<void>;
}

export const useSoundOutputStore = create<SoundOutputStore>((set) => ({
  devices: [],
  errorCode: null,
  switching: false,

  refresh: async () => {
    try {
      set({ devices: await commands.soundOutputList(), errorCode: null });
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    }
  },

  choose: async (id) => {
    set({ switching: true, errorCode: null });
    try {
      set({ devices: await commands.soundOutputSet(id) });
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    } finally {
      set({ switching: false });
    }
  },
}));
