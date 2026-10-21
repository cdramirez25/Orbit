import { create } from 'zustand';

import { useIslandStore } from '@/stores/island.store';
import type { OrbitModule } from '@/types';

/**
 * Registro y arbitraje de módulos (§4.3): la actividad de mayor prioridad ocupa la isla y las
 * demás quedan en cola. Añadir un módulo = registrarlo aquí; `Island.tsx` no se toca.
 */

interface RegistryStore {
  modules: Record<string, OrbitModule>;
  /** Ids de módulos con actividad en curso. */
  activities: string[];
  /** Módulo que el usuario eligió con el selector; decide entre módulos de igual prioridad. */
  selectedId: string | null;
  register: (module: OrbitModule) => void;
  startActivity: (id: string) => void;
  endActivity: (id: string) => void;
  select: (id: string | null) => void;
}

/**
 * Módulo con actividad y mayor prioridad. A igualdad gana el elegido por el usuario y, si no hay
 * ninguno elegido, el que empezó antes.
 */
export function pickActive(
  modules: Record<string, OrbitModule>,
  activities: readonly string[],
  selectedId: string | null = null,
): OrbitModule | null {
  let best: OrbitModule | null = null;
  for (const id of activities) {
    const candidate = modules[id];
    if (!candidate) continue;
    if (best === null || candidate.priority > best.priority) best = candidate;
    else if (candidate.priority === best.priority && candidate.id === selectedId) best = candidate;
  }
  return best;
}

export const useRegistryStore = create<RegistryStore>((set, get) => ({
  modules: {},
  activities: [],
  selectedId: null,

  register: (module) => set((s) => ({ modules: { ...s.modules, [module.id]: module } })),

  startActivity: (id) => {
    const { activities, modules } = get();
    if (activities.includes(id) || !modules[id]) return;
    set({ activities: [...activities, id] });
    modules[id].onActivate?.();
  },

  endActivity: (id) => {
    const { activities, modules } = get();
    if (!activities.includes(id)) return;
    set({ activities: activities.filter((a) => a !== id) });
    modules[id]?.onDeactivate?.();
  },

  select: (id) => set({ selectedId: id }),
}));

export function selectActiveModule(state: RegistryStore): OrbitModule | null {
  return pickActive(state.modules, state.activities, state.selectedId);
}

/** Mantiene la isla en sintonía con las actividades: hay actividad → compact; no hay → idle. */
export function bindRegistryToIsland(): () => void {
  return useRegistryStore.subscribe((state, prev) => {
    const hadActivity = prev.activities.length > 0;
    const hasActivity = state.activities.length > 0;
    if (hadActivity === hasActivity) return;

    const { snapshot, send } = useIslandStore.getState();
    if (hasActivity && snapshot.state === 'idle') send({ type: 'ACTIVATE' });
    if (!hasActivity && snapshot.state === 'compact') send({ type: 'DEACTIVATE' });
    if (!hasActivity && snapshot.state === 'expanded') {
      send({ type: 'COLLAPSE' }, { type: 'DEACTIVATE' });
    }
  });
}
