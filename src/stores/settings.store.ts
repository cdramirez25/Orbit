import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import type { IslandAnchor, IslandStyle, SttLanguage } from '@/types';

interface SettingsStore {
  islandStyle: IslandStyle;
  hideFromScreenShare: boolean;
  /** Dónde está la isla: izquierda, centro (automático), derecha o libre. */
  anchor: IslandAnchor;
  /** Idioma de la transcripción: automático o uno fijo. */
  sttLanguage: SttLanguage;
  /** ¿Ya terminó (o saltó) la guía de primer arranque? */
  onboardingDone: boolean;
  setIslandStyle: (style: IslandStyle) => void;
  setHideFromScreenShare: (hide: boolean) => void;
  setAnchor: (anchor: IslandAnchor) => Promise<void>;
  setSttLanguage: (language: SttLanguage) => Promise<void>;
  setOnboardingDone: (done: boolean) => Promise<void>;
  /** Carga lo guardado por Rust (ancla, ocultar de screen share…). */
  load: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  islandStyle: 'floating',
  hideFromScreenShare: true,
  anchor: 'center',
  sttLanguage: 'auto',
  onboardingDone: true,

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

  setSttLanguage: async (sttLanguage) => {
    set({ sttLanguage });
    try {
      const saved = await commands.setSttLanguage(sttLanguage);
      set({ sttLanguage: saved.sttLanguage });
    } catch {
      // Se mantiene el valor local; Rust no pudo aplicarlo.
    }
  },

  setOnboardingDone: async (onboardingDone) => {
    set({ onboardingDone });
    try {
      const saved = await commands.setOnboardingDone(onboardingDone);
      set({ onboardingDone: saved.onboardingDone });
    } catch {
      // Se mantiene el valor local; Rust no pudo guardarlo.
    }
  },

  load: async () => {
    try {
      const saved = await commands.getIslandSettings();
      set({
        anchor: saved.islandAnchor,
        hideFromScreenShare: saved.hideFromScreenShare,
        sttLanguage: saved.sttLanguage,
        onboardingDone: saved.onboardingDone,
      });
    } catch {
      // Sin ajustes guardados se queda con los valores por defecto.
    }
  },
}));
