import { isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { PipelineEventName, PipelineEvents } from '@/types';

/** Suscripción tipada a los eventos del backend (espejo de `events.rs`). */
export async function onEvent<K extends PipelineEventName>(
  name: K,
  handler: (payload: PipelineEvents[K]) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<PipelineEvents[K]>(name, (event) => handler(event.payload));
}
