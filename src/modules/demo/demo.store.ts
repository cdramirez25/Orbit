import { create } from 'zustand';

import { translate } from '@/i18n/locale.store';
import { useRegistryStore } from '@/modules/registry';
import { useAnswerStore } from '@/stores/answer.store';
import { useAudioStore } from '@/stores/audio.store';
import { useIslandStore } from '@/stores/island.store';
import { useTranscriptStore } from '@/stores/transcript.store';
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
  /** Descarta la respuesta simulada (por ejemplo, al empezar a escuchar de nuevo). */
  resetAnswer: () => void;
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

  resetAnswer: () => {
    clearInterval(streamTimer);
    set({ answer: null, streaming: false });
  },

  showDemoAlert: () => {
    const island = useIslandStore.getState();
    if (island.snapshot.state === 'hidden') island.goTo('idle');
    island.showAlert({ title: translate('demo.detected'), message: translate('demo.question') });
  },
}));

/**
 * La respuesta simulada ocupa la isla mientras su tarjeta esté abierta. Al cerrarla (la isla deja
 * de estar expandida) el módulo de demostración termina y vuelven los módulos de siempre (clima,
 * portapapeles, música). Si se está escuchando, sigue: las ondas son suyas.
 */
export function bindDemoToIsland(): () => void {
  return useIslandStore.subscribe((state, previous) => {
    const was = previous.snapshot.state;
    const now = state.snapshot.state;
    // Un aviso (`alert`) se muestra sobre la tarjeta y vuelve a ella: no cuenta como cerrarla.
    const closedCard = was === 'expanded' && now !== 'expanded' && now !== 'alert';
    if (closedCard && !useAudioStore.getState().listening) {
      useRegistryStore.getState().endActivity(DEMO_MODULE_ID);
    }
  });
}

/**
 * Mientras se escucha, la isla muestra la pastilla compacta del módulo (punto + ondas); al parar
 * vuelve a reposo o, si hay módulos residentes (clima, portapapeles), a su pastilla.
 * (El Prompter real hará esto mismo con sus propias actividades.)
 */
export function bindListeningToIsland(): () => void {
  return useAudioStore.subscribe((state, previous) => {
    if (state.listening === previous.listening) return;
    if (state.listening) {
      // Cada escucha empieza con la transcripción limpia y sin la respuesta simulada.
      useTranscriptStore.getState().clear();
      useAnswerStore.getState().clear();
      useDemoStore.getState().resetAnswer();
      useDemoStore.getState().goTo('compact');
      return;
    }
    // Al parar termina la actividad de escucha; si quedan módulos residentes, vuelve su pastilla.
    useRegistryStore.getState().endActivity(DEMO_MODULE_ID);
    const othersActive = useRegistryStore.getState().activities.length > 0;
    useIslandStore.getState().goTo(othersActive ? 'compact' : 'idle');
  });
}

/**
 * Cuando llega la primera palabra de una escucha, la tarjeta se abre sola para que se vea la
 * transcripción. Solo una vez por escucha (la transcripción se vacía al empezar): si el usuario la
 * cierra, no se vuelve a abrir con cada frase. No pisa una tarjeta ya abierta ni un aviso.
 */
export function bindTranscriptToIsland(): () => void {
  return useTranscriptStore.subscribe((state, previous) => {
    const hasText = (s: typeof state) => s.lines.length > 0 || s.partial !== '';
    if (!hasText(state) || hasText(previous)) return;
    if (!useAudioStore.getState().listening) return;
    if (useIslandStore.getState().snapshot.state === 'compact') {
      useDemoStore.getState().goTo('expanded');
    }
  });
}

/**
 * Cuando la IA empieza a contestar una pregunta nueva, la tarjeta se abre sola para que se vea la
 * respuesta, también cuando la pregunta se escribió en Ajustes. No pisa una tarjeta ya abierta ni un
 * aviso; si el usuario la cerró, la siguiente pregunta la vuelve a abrir (es justo lo que viene a buscar).
 */
export function bindAnswerToIsland(): () => void {
  return useAnswerStore.subscribe((state, previous) => {
    if (state.question === null || state.question === previous.question) return;
    // Una pregunta (oída o escrita en Ajustes) siempre muestra su respuesta: se abre desde reposo,
    // compacta u oculta. Una tarjeta ya abierta o un aviso no se pisan.
    const islandState = useIslandStore.getState().snapshot.state;
    if (islandState === 'compact' || islandState === 'idle' || islandState === 'hidden') {
      useDemoStore.getState().goTo('expanded');
    }
  });
}
