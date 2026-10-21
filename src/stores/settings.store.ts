import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import type { IslandAnchor, IslandStyle } from '@/types';

interface SettingsStore {
  islandStyle: IslandStyle;
  hideFromScreenShare: boolean;
  /** Dónde está la isla: izquierda, centro (automático), derecha o libre. */
  anchor: IslandAnchor;
  setIslandStyle: (style: IslandStyle) => void;
  setHideFromScreenShare: (hide: boolean) => void;
  setAnchor: (anchor: IslandAnchor) => Promise<void>;
  /** Carga lo guardado por Rust (ancla, ocultar de screen share). */
  load: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  islandStyle: 'floating',
  hideFromScreenShare: true,
  anchor: 'center',

  setIslandStyle: (islandStyle) => set({ islandStyle }),

  setHideFromScreenShare: (hideFromScreenShare) => {
    set({ hideFromScreenShare });
    void commands.setContentProtected(hideFromScreenShare);
  },

  setAnchor: async (anchor) => {
    set({ anchor });
    try {
      const saved = await commands.setIslandAnchor(anchor);
      set({ anchor: saved.islandAnchor });
    } catch {
      // Se mantiene el valor local; Rust no pudo aplicarlo.
    }
  },

  load: async () => {
    try {
      const saved = await commands.getIslandSettings();
      set({ anchor: saved.islandAnchor, hideFromScreenShare: saved.hideFromScreenShare });
    } catch {
      // Sin ajustes guardados se queda con los valores por defecto.
    }
  },
}));
