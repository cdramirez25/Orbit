import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import type { PermissionStatus } from '@/types';

interface AudioStore {
  /** Permiso para capturar el audio del sistema; `null` = todavía no se ha consultado. */
  permission: PermissionStatus | null;
  /** Vuelve a consultar el estado (por ejemplo, cuando el usuario vuelve de Ajustes del Sistema). */
  refresh: () => Promise<void>;
  /** Pide el permiso: el aviso del sistema sale solo la primera vez. */
  request: () => Promise<void>;
  /** Abre la pantalla de Ajustes del Sistema donde se concede. */
  openSettings: () => Promise<void>;
}

export const useAudioStore = create<AudioStore>((set) => ({
  permission: null,

  refresh: async () => {
    try {
      set({ permission: await commands.getAudioPermission() });
    } catch {
      // Se conserva el último estado conocido; la siguiente consulta lo reintenta.
    }
  },

  request: async () => {
    try {
      set({ permission: await commands.requestAudioPermission() });
    } catch {
      // Sin respuesta del sistema: se queda como estaba.
    }
  },

  openSettings: async () => {
    try {
      await commands.openAudioPermissionSettings();
    } catch {
      // No se pudo abrir Ajustes; el usuario puede ir a mano (Privacidad y seguridad).
    }
  },
}));
