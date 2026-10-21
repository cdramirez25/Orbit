import { isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { PipelineEventName, PipelineEvents } from '@/types';

type LocalHandler = (payload: unknown) => void;

// Solo navegador (sin Tauri): bus local para que la simulación de `ipc/commands.ts` pueda
// emitir los mismos eventos que emitiría Rust.
const localHandlers = new Map<PipelineEventName, Set<LocalHandler>>();

/** Solo navegador: emite un evento a los suscriptores locales. */
export function emitLocal<K extends PipelineEventName>(name: K, payload: PipelineEvents[K]): void {
  localHandlers.get(name)?.forEach((handler) => handler(payload));
}

/** Suscripción tipada a los eventos del backend (espejo de `events.rs`). */
export async function onEvent<K extends PipelineEventName>(
  name: K,
  handler: (payload: PipelineEvents[K]) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    const handlers = localHandlers.get(name) ?? new Set<LocalHandler>();
    const wrapped: LocalHandler = (payload) => handler(payload as PipelineEvents[K]);
    handlers.add(wrapped);
    localHandlers.set(name, handlers);
    return () => {
      handlers.delete(wrapped);
    };
  }
  return listen<PipelineEvents[K]>(name, (event) => handler(event.payload));
}
