import { create } from 'zustand';

import { translate } from '@/i18n/locale.store';
import { LISTEN_MODULE_ID } from '@/modules/listen/id';
import { PROMPTER_MODULE_ID } from '@/modules/prompter/id';
import { useRegistryStore } from '@/modules/registry';
import { useAnswerStore } from '@/stores/answer.store';
import { useAudioStore } from '@/stores/audio.store';
import { useIslandStore } from '@/stores/island.store';
import { useQuestionStore } from '@/stores/question.store';
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
 * Elige una tarjeta entre los módulos y abre la isla desde reposo, compacta u oculta. Una tarjeta ya
 * abierta o un aviso no se pisan.
 */
function showModule(id: string): void {
  useRegistryStore.getState().select(id);
  const island = useIslandStore.getState();
  const state = island.snapshot.state;
  if (state === 'compact' || state === 'idle' || state === 'hidden') island.goTo('expanded');
}

/** Muestra la tarjeta de IA. */
export function showPrompter(): void {
  showModule(PROMPTER_MODULE_ID);
}

/**
 * ¿La escucha que está empezando es la de una pregunta (botón Grabar audio o su atajo)? Entonces la
 * isla enseña la tarjeta de IA. Cualquier otra (el botón Escuchar de Ajustes o el de la tarjeta de
 * transcripción) enseña la tarjeta de transcripción, que no tiene nada de IA. El botón de grabar
 * marca `busy` antes de pedirle nada a Rust, así que ya está marcado cuando llega el aviso de que
 * se empezó a escuchar.
 */
function listeningCard(): string {
  const question = useQuestionStore.getState();
  return question.busy || question.recording ? PROMPTER_MODULE_ID : LISTEN_MODULE_ID;
}

/**
 * Al empezar a escuchar la tarjeta correspondiente se elige sola (la de IA si es una pregunta; la de
 * transcripción si es el botón Escuchar de Ajustes) y se parte de cero: sin la transcripción ni la
 * respuesta de la vez anterior. La isla pasa a compacta si estaba en reposo, pero una tarjeta abierta
 * se queda abierta: es donde se pulsa el botón.
 */
export function bindListeningToIsland(): () => void {
  return useAudioStore.subscribe((state, previous) => {
    if (state.listening === previous.listening || !state.listening) return;
    useTranscriptStore.getState().clear();
    useAnswerStore.getState().clear();
    useDemoStore.getState().resetAnswer();
    useRegistryStore.getState().select(listeningCard());
    const island = useIslandStore.getState();
    if (island.snapshot.state === 'hidden' || island.snapshot.state === 'idle') {
      island.goTo('compact');
    }
  });
}

/**
 * Cuando llega la primera palabra de una escucha, la tarjeta se abre sola para que se vea lo que se
 * oye. Solo una vez por escucha (la transcripción se vacía al empezar): si el usuario la cierra, no
 * se vuelve a abrir con cada frase.
 */
export function bindTranscriptToIsland(): () => void {
  return useTranscriptStore.subscribe((state, previous) => {
    const hasText = (s: typeof state) => s.lines.length > 0 || s.partial !== '';
    if (!hasText(state) || hasText(previous)) return;
    if (!useAudioStore.getState().listening) return;
    showModule(listeningCard());
  });
}

/**
 * Cuando la IA empieza a contestar una pregunta nueva, la tarjeta se abre sola para que se vea la
 * respuesta, también cuando la pregunta se escribió en Ajustes. Si el usuario la cerró, la siguiente
 * pregunta la vuelve a abrir (es justo lo que viene a buscar).
 *
 * La única excepción: mientras se está mirando la transcripción en vivo (la tarjeta de transcripción
 * abierta y escuchando), la respuesta no lo saca de ahí; está en la tarjeta de IA cuando la quiera ver.
 */
export function bindAnswerToIsland(): () => void {
  return useAnswerStore.subscribe((state, previous) => {
    if (state.question === null || state.question === previous.question) return;
    const watchingTranscription =
      useRegistryStore.getState().selectedId === LISTEN_MODULE_ID &&
      useIslandStore.getState().snapshot.state === 'expanded' &&
      useAudioStore.getState().listening;
    if (watchingTranscription) return;
    showPrompter();
  });
}
