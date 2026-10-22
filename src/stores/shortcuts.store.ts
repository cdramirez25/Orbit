import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import type { ShortcutInfo, UiAction } from '@/types';

interface ShortcutStore {
  shortcuts: ShortcutInfo[];
  /** El último cambio que no se pudo hacer: qué atajo y por qué (`shortcut.duplicate`…). */
  error: { action: UiAction; code: string } | null;
  load: () => Promise<void>;
  /** Cambia el atajo de una acción. Devuelve si se pudo; si no, el motivo queda en `error`. */
  change: (action: UiAction, keys: string) => Promise<boolean>;
  /** Devuelve el atajo de una acción al de por defecto. */
  reset: (action: UiAction) => Promise<boolean>;
  clearError: () => void;
}

export const useShortcutStore = create<ShortcutStore>((set) => {
  const apply = async (
    action: UiAction,
    request: () => Promise<ShortcutInfo[]>,
  ): Promise<boolean> => {
    set({ error: null });
    try {
      set({ shortcuts: await request() });
      return true;
    } catch (error) {
      set({ error: { action, code: commandErrorCode(error) ?? 'unknown' } });
      return false;
    }
  };

  return {
    shortcuts: [],
    error: null,

    load: async () => {
      try {
        set({ shortcuts: await commands.getShortcuts() });
      } catch {
        // Sin la lista no se muestra la sección de atajos.
      }
    },

    change: (action, keys) => apply(action, () => commands.setShortcut(action, keys)),
    reset: (action) => apply(action, () => commands.resetShortcut(action)),
    clearError: () => set({ error: null }),
  };
});
