import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import type { ShortcutInfo } from '@/types';

interface ShortcutStore {
  shortcuts: ShortcutInfo[];
  load: () => Promise<void>;
}

export const useShortcutStore = create<ShortcutStore>((set) => ({
  shortcuts: [],

  load: async () => {
    try {
      set({ shortcuts: await commands.getShortcuts() });
    } catch {
      // Sin la lista no se muestra la sección de atajos.
    }
  },
}));
