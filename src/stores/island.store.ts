import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import {
  eventsToReach,
  INITIAL_SNAPSHOT,
  reduceAll,
  type IslandEvent,
  type IslandSnapshot,
} from '@/lib/island/island.machine';
import type { ExpandedSize, IslandAlert, IslandState, NotchInfo } from '@/types';

const ALERT_DURATION_MS = 2800;

let alertTimer: ReturnType<typeof setTimeout> | undefined;

interface IslandStore {
  snapshot: IslandSnapshot;
  alert: IslandAlert | null;
  notch: NotchInfo | null;
  /** Tarjeta expandida normal (~4 filas) o alargada (~8). Vuelve a `normal` al salir de `expanded`. */
  expandedSize: ExpandedSize;
  toggleExpandedSize: () => void;
  /** Mientras se arrastra la isla (modo libre) la ventana debe seguir capturando el mouse. */
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
  /** Aplica uno o varios eventos de una sola vez (un solo render, sin estados intermedios). */
  send: (...events: IslandEvent[]) => void;
  /** Recorre la cadena de transiciones válidas hasta `target` (botones de demo). */
  goTo: (target: IslandState) => void;
  showAlert: (alert: IslandAlert, durationMs?: number) => void;
  loadNotch: () => Promise<void>;
}

export const useIslandStore = create<IslandStore>((set, get) => ({
  snapshot: INITIAL_SNAPSHOT,
  alert: null,
  notch: null,
  expandedSize: 'normal',
  dragging: false,

  toggleExpandedSize: () => {
    if (get().snapshot.state !== 'expanded') return;
    set((s) => ({ expandedSize: s.expandedSize === 'tall' ? 'normal' : 'tall' }));
  },

  setDragging: (dragging) => {
    set({ dragging });
    if (dragging) document.body.dataset.dragging = '';
    else delete document.body.dataset.dragging;
  },

  send: (...events) => {
    const current = get().snapshot;
    const next = reduceAll(current, events);
    if (next === current) return;

    // La tarjeta alargada vuelve a su tamaño normal al salir de `expanded` (salvo si es un
    // `alert` que regresará a ella: entonces se conserva).
    const staysExpanded =
      next.state === 'expanded' || (next.state === 'alert' && next.returnTo === 'expanded');
    set(staysExpanded ? { snapshot: next } : { snapshot: next, expandedSize: 'normal' });
  },

  goTo: (target) => {
    const { snapshot, send } = get();
    send(...eventsToReach(snapshot, target));
  },

  showAlert: (alert, durationMs = ALERT_DURATION_MS) => {
    clearTimeout(alertTimer);
    set({ alert });
    const { snapshot, send } = get();
    if (snapshot.state === 'hidden') return;
    if (snapshot.state !== 'alert') send({ type: 'ALERT' });
    alertTimer = setTimeout(() => get().send({ type: 'ALERT_END' }), durationMs);
  },

  loadNotch: async () => {
    try {
      set({ notch: await commands.getNotchInfo() });
    } catch {
      set({ notch: null });
    }
  },
}));
