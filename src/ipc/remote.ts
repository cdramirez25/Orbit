import { isTauri } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { RemoteCommand, RemoteState } from '@/types';

/**
 * Mensajes entre la ventana de ajustes y la de la isla (§4.0: solo `ipc/` habla con el exterior).
 * En Tauri viajan como eventos de la app; en el navegador (`pnpm dev`), con un `BroadcastChannel`
 * entre pestañas del mismo origen (`island.html` y `settings.html`).
 */

const COMMAND = 'ui:command';
const STATE = 'ui:state';
const STATE_REQUEST = 'ui:state-request';

interface BrowserMessage {
  name: string;
  payload: unknown;
}

const browserChannel =
  typeof BroadcastChannel !== 'undefined' && !isTauri()
    ? new BroadcastChannel('orbit-remote')
    : null;

async function send(name: string, payload: unknown): Promise<void> {
  if (isTauri()) await emit(name, payload);
  else browserChannel?.postMessage({ name, payload } satisfies BrowserMessage);
}

async function on<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (isTauri()) return listen<T>(name, (event) => handler(event.payload));

  const onMessage = (event: MessageEvent<BrowserMessage>) => {
    if (event.data.name === name) handler(event.data.payload as T);
  };
  browserChannel?.addEventListener('message', onMessage);
  return () => browserChannel?.removeEventListener('message', onMessage);
}

export const remote = {
  /** Ajustes → isla: una orden. */
  sendCommand: (command: RemoteCommand): Promise<void> => send(COMMAND, command),
  onCommand: (handler: (command: RemoteCommand) => void): Promise<UnlistenFn> =>
    on(COMMAND, handler),

  /** Isla → ajustes: el estado actual de la isla. */
  publishState: (state: RemoteState): Promise<void> => send(STATE, state),
  onState: (handler: (state: RemoteState) => void): Promise<UnlistenFn> => on(STATE, handler),

  /** Ajustes → isla: "mándame tu estado" (al abrir la ventana). */
  requestState: (): Promise<void> => send(STATE_REQUEST, null),
  onStateRequest: (handler: () => void): Promise<UnlistenFn> => on(STATE_REQUEST, handler),
};
