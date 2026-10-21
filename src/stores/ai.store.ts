import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import type { AiProviderId, AiSaveInput, AiStatus } from '@/types';

/** Cómo salió la última prueba de un proveedor. */
export type AiTestResult =
  { id: AiProviderId; ok: true; reply: string } | { id: AiProviderId; ok: false; code: string };

interface AiStore {
  /** Lo guardado (`null` = todavía no se ha cargado). Nunca incluye claves. */
  status: AiStatus | null;
  /** Modelos que ofrece cada proveedor, ya pedidos (sirven de sugerencias al elegir uno). */
  models: Partial<Record<AiProviderId, string[]>>;
  /** Proveedor que se está guardando o probando ahora mismo. */
  busy: { id: AiProviderId; action: 'save' | 'test' } | null;
  testResult: AiTestResult | null;
  /** Último error al guardar un proveedor (`ai.keychain`…); `null` si no hubo. */
  saveError: { id: AiProviderId; code: string } | null;
  load: () => Promise<void>;
  /** Devuelve si se guardó. La clave sale de aquí hacia Rust y no se conserva. */
  save: (id: AiProviderId, input: AiSaveInput) => Promise<boolean>;
  setActive: (id: AiProviderId | null) => Promise<void>;
  test: (id: AiProviderId) => Promise<void>;
  loadModels: (id: AiProviderId) => Promise<void>;
}

export const useAiStore = create<AiStore>((set, get) => ({
  status: null,
  models: {},
  busy: null,
  testResult: null,
  saveError: null,

  load: async () => {
    try {
      set({ status: await commands.aiGetStatus() });
    } catch {
      // Se conserva lo que había; la pantalla lo vuelve a pedir al abrirse.
    }
  },

  save: async (id, input) => {
    set({ busy: { id, action: 'save' }, saveError: null, testResult: null });
    try {
      const status = await commands.aiSaveProvider(id, input);
      // Con otra clave o dirección, la lista de modelos de antes ya no vale.
      set((state) => ({ status, models: { ...state.models, [id]: undefined } }));
      return true;
    } catch (error) {
      set({ saveError: { id, code: commandErrorCode(error) ?? 'unknown' } });
      return false;
    } finally {
      set({ busy: null });
    }
  },

  setActive: async (id) => {
    try {
      set({ status: await commands.aiSetActive(id) });
    } catch {
      await get().load();
    }
  },

  test: async (id) => {
    set({ busy: { id, action: 'test' }, testResult: null });
    try {
      const reply = await commands.aiTestProvider(id);
      set({ testResult: { id, ok: true, reply } });
    } catch (error) {
      set({ testResult: { id, ok: false, code: commandErrorCode(error) ?? 'unknown' } });
    } finally {
      set({ busy: null });
    }
  },

  loadModels: async (id) => {
    try {
      const models = await commands.aiListModels(id);
      set((state) => ({ models: { ...state.models, [id]: models } }));
    } catch {
      // Sin lista no pasa nada: el modelo se puede escribir a mano.
      set((state) => ({ models: { ...state.models, [id]: [] } }));
    }
  },
}));
