import { create } from 'zustand';

import { commands } from '@/ipc/commands';

/**
 * La ventana de ajustes solo existe en desarrollo (`pnpm tauri dev`); en producción la reemplazará
 * la de la Fase 5.
 */
export const SETTINGS_WINDOW_AVAILABLE = import.meta.env.DEV;

interface SettingsWindowStore {
  /** Abre la ventana de ajustes o la trae al frente. */
  open: () => void;
}

export const useSettingsWindowStore = create<SettingsWindowStore>(() => ({
  open: () => void commands.openSettingsWindow(),
}));
