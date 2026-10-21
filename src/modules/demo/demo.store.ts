import { create } from 'zustand';

import { useRegistryStore } from '@/modules/registry';
import { useIslandStore } from '@/stores/island.store';
import type { IslandState } from '@/types';

export const DEMO_MODULE_ID = 'demo';

const SAMPLE_QUESTION = '¿Cuál es la capital de Australia?';
const SAMPLE_ANSWER = 'Canberra';

const STREAM_TEXT =
  'Canberra. Muchos piensan que es Sídney o Melbourne, pero se eligió como capital en 1908 ' +
  'precisamente como punto medio entre ambas ciudades rivales. Se fundó en 1913 y el Parlamento ' +
  'se trasladó allí en 1927. Es la ciudad más grande del interior de Australia, y su nombre ' +
  'viene de una palabra aborigen que se suele traducir como "lugar de encuentro".';

const CHARS_PER_TICK = 3;
const TICK_MS = 35;

let streamTimer: ReturnType<typeof setInterval> | undefined;

interface DemoStore {
  question: string;
  answer: string;
  streaming: boolean;
  /** Va a un estado de la isla, arrancando/terminando la actividad del módulo cuando toca. */
  goTo: (target: IslandState) => void;
  /** Simula la respuesta del LLM llegando token a token (para ver crecer la tarjeta). */
  streamAnswer: () => void;
  showDemoAlert: () => void;
}

export const useDemoStore = create<DemoStore>((set, get) => ({
  question: SAMPLE_QUESTION,
  answer: SAMPLE_ANSWER,
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

    let shown = 0;
    streamTimer = setInterval(() => {
      shown = Math.min(shown + CHARS_PER_TICK, STREAM_TEXT.length);
      set({ answer: STREAM_TEXT.slice(0, shown) });
      if (shown >= STREAM_TEXT.length) {
        clearInterval(streamTimer);
        set({ streaming: false });
      }
    }, TICK_MS);
  },

  showDemoAlert: () => {
    const island = useIslandStore.getState();
    if (island.snapshot.state === 'hidden') island.goTo('idle');
    island.showAlert({ title: 'Pregunta detectada', message: SAMPLE_QUESTION });
  },
}));
