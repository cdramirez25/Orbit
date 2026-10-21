import { create } from 'zustand';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { remote } from '@/ipc/remote';
import type { IslandAnchor, IslandState, IslandStyle, Locale, RemoteState } from '@/types';

/**
 * Control remoto de la isla desde la ventana de ajustes. Esta ventana no tiene la isla: guarda un
 * espejo de su estado (que la isla le va mandando) y le envía órdenes.
 */
interface ControlStore extends RemoteState {
  goTo: (state: IslandState) => void;
  simulate: () => void;
  alert: () => void;
  setStyle: (style: IslandStyle) => void;
  setAnchor: (anchor: IslandAnchor) => void;
  setLocale: (locale: Locale) => void;
  quit: () => void;
  /** Se suscribe al estado de la isla y se lo pide. Devuelve cómo desuscribirse. */
  bind: () => Promise<() => void>;
}

export const useControlStore = create<ControlStore>((set) => ({
  islandState: 'idle',
  style: 'floating',
  anchor: 'center',

  // Los cambios se reflejan al instante en el espejo; la isla confirma con su estado real.
  goTo: (islandState) => {
    set({ islandState });
    void remote.sendCommand({ type: 'goTo', state: islandState });
  },
  simulate: () => void remote.sendCommand({ type: 'simulate' }),
  alert: () => void remote.sendCommand({ type: 'alert' }),
  setStyle: (style) => {
    set({ style });
    void remote.sendCommand({ type: 'setStyle', style });
  },
  setAnchor: (anchor) => {
    set({ anchor });
    void remote.sendCommand({ type: 'setAnchor', anchor });
  },
  setLocale: (locale) => {
    useLocaleStore.getState().setLocale(locale);
    void remote.sendCommand({ type: 'setLocale', locale });
  },
  quit: () => void commands.quitApp(),

  bind: async () => {
    const off = await remote.onState((state) => set(state));
    await remote.requestState();
    return off;
  },
}));
