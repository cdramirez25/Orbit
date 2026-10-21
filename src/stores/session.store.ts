import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import { onEvent } from '@/ipc/events';
import type { Session, SessionMessage, SessionsState, SessionUpdate } from '@/types';

interface SessionStore {
  /** Las sesiones (`null` = todavía no se han cargado). */
  state: SessionsState | null;
  /** Preguntas y respuestas de la sesión activa, de la más antigua a la más nueva. */
  messages: SessionMessage[];
  /** Código del último error al cambiar una sesión (`session.emptyName`…); `null` si no hubo. */
  errorCode: string | null;
  load: () => Promise<void>;
  /** Crea una sesión y la deja activa. Devuelve si se pudo. */
  create: (name: string, prompt?: string) => Promise<boolean>;
  update: (id: number, update: SessionUpdate) => Promise<boolean>;
  remove: (id: number) => Promise<void>;
  setActive: (id: number | null) => Promise<void>;
  /** Vacía el historial (conserva la sesión y su prompt). */
  clearHistory: (id: number) => Promise<void>;
  /** Se suscribe a `sessions:changed` y carga lo que hay. Devuelve cómo desuscribirse. */
  bind: () => Promise<() => void>;
}

/** La sesión activa (o `null`). */
export function selectActiveSession(store: Pick<SessionStore, 'state'>): Session | null {
  const state = store.state;
  return state?.sessions.find((session) => session.id === state.active) ?? null;
}

export const useSessionStore = create<SessionStore>((set, get) => {
  /** Aplica el estado que devuelve Rust y recarga el historial de la sesión activa. */
  const apply = async (state: SessionsState) => {
    set({ state, errorCode: null });
    const active = state.active;
    if (active === null) {
      set({ messages: [] });
      return;
    }
    try {
      const messages = await commands.sessionMessages(active);
      // Si mientras tanto se cambió de sesión, esto ya no vale.
      if (get().state?.active === active) set({ messages });
    } catch {
      set({ messages: [] });
    }
  };

  const run = async (action: () => Promise<SessionsState>): Promise<boolean> => {
    try {
      await apply(await action());
      return true;
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
      return false;
    }
  };

  return {
    state: null,
    messages: [],
    errorCode: null,

    load: async () => {
      try {
        await apply(await commands.sessionGetState());
      } catch {
        // Se conserva lo que había; el siguiente cambio lo vuelve a pedir.
      }
    },

    create: (name, prompt) => run(() => commands.sessionCreate(name, prompt ?? '')),
    update: (id, update) => run(() => commands.sessionUpdate(id, update)),
    remove: async (id) => {
      await run(() => commands.sessionDelete(id));
    },
    setActive: async (id) => {
      await run(() => commands.sessionSetActive(id));
    },

    clearHistory: async (id) => {
      try {
        await commands.sessionClear(id);
        await get().load();
      } catch (error) {
        set({ errorCode: commandErrorCode(error) ?? 'unknown' });
      }
    },

    bind: async () => {
      const off = await onEvent('sessions:changed', () => void get().load());
      await get().load();
      return off;
    },
  };
});
