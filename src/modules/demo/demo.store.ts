import { create } from 'zustand';

import { translate } from '@/i18n/locale.store';
import { useRegistryStore } from '@/modules/registry';
import { useIslandStore } from '@/stores/island.store';
import type { IslandState } from '@/types';

export const DEMO_MODULE_ID = 'demo';

const CHARS_PER_TICK = 3;
const TICK_MS = 35;

let streamTimer: ReturnType<typeof setInterval> | undefined;

interface DemoStore {
  /** Respuesta que va llegando; `null` = todavía no se simuló nada (se muestra la corta). */
  answer: string | null;
  streaming: boolean;
  /** Va a un estado de la isla, arrancando/terminando la actividad del módulo cuando toca. */
  goTo: (target: IslandState) => void;
  /** Simula la respuesta del LLM llegando token a token (para ver crecer la tarjeta). */
  streamAnswer: () => void;
  showDemoAlert: () => void;
}

export const useDemoStore = create<DemoStore>((set, get) => ({
  answer: null,
  streaming: false,

  goTo: (target) => {
    const registry = useRegistryStore.getState();
    const island = useIslandStore.getState();

    if (target === 'compact' || target === 'expanded') registry.startActivity(DEMO_MODULE_ID);
    island.goTo(target);
    if (target === 'idle' || target === 'hidden') registry.endActivity(DEMO_MODULE_ID);
  },

  streamAnswer: () => {
    clearInterval(streamTimer);
    get().goTo('expanded');
    set({ answer: '', streaming: true });

    // El texto de ejemplo sale del diccionario del idioma activo al empezar.
    const text = translate('demo.answerLong');
    let shown = 0;
    streamTimer = setInterval(() => {
      shown = Math.min(shown + CHARS_PER_TICK, text.length);
      set({ answer: text.slice(0, shown) });
      if (shown >= text.length) {
        clearInterval(streamTimer);
        set({ streaming: false });
      }
    }, TICK_MS);
  },

  showDemoAlert: () => {
    const island = useIslandStore.getState();
    if (island.snapshot.state === 'hidden') island.goTo('idle');
    island.showAlert({ title: translate('demo.detected'), message: translate('demo.question') });
  },
}));
