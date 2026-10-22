import { onEvent } from '@/ipc/events';
import { showPrompter } from '@/modules/demo/demo.store';
import { useIslandStore } from '@/stores/island.store';
import { useQuestionStore } from '@/stores/question.store';
import type { UiAction } from '@/types';

/** Oculta la isla; si ya estaba oculta, vuelve a su forma compacta. */
function toggleIsland(): void {
  const island = useIslandStore.getState();
  island.goTo(island.snapshot.state === 'hidden' ? 'compact' : 'hidden');
}

/**
 * Empieza a grabar la pregunta o, si ya se estaba grabando, la termina y se la manda a la IA. Si
 * falla (sin permiso, sin voz…) se abre la tarjeta de IA para que el motivo se vea.
 */
async function toggleQuestion(): Promise<void> {
  const question = useQuestionStore.getState();
  if (question.recording) await question.finish();
  else await question.start();
  if (useQuestionStore.getState().errorCode !== null) showPrompter();
}

/** Ejecuta lo que pide un atajo global o la bandeja del sistema. */
export function applyUiAction(action: UiAction): void {
  switch (action) {
    case 'toggleQuestion':
      void toggleQuestion();
      break;
    case 'toggleIsland':
      toggleIsland();
      break;
  }
}

/** Atiende los atajos globales y la bandeja (Rust los publica como el evento `ui:action`). */
export function bindUiActions(): Promise<() => void> {
  return onEvent('ui:action', applyUiAction);
}
