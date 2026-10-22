import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import type { AiProviderId, AiSaveInput, AiStatus } from '@/types';

/** Los modelos que ofrece un proveedor con la clave que se está escribiendo y todavía no se guardó. */
export interface TypedKeyModels {
  state: 'loading' | 'ready' | 'error';
  models: string[];
  /** Código del error si `state` es `error`. */
  code: string | null;
}

/** Para ignorar respuestas viejas: cada petición de la lista con la clave escrita lleva su número. */
const previewSeq: Partial<Record<AiProviderId, number>> = {};

/** Cómo salió la última prueba de un proveedor. */
export type AiTestResult =
  { id: AiProviderId; ok: true; reply: string } | { id: AiProviderId; ok: false; code: string };

interface AiStore {
  /** Lo guardado (`null` = todavía no se ha cargado). Nunca incluye claves. */
  status: AiStatus | null;
  /** Modelos que ofrece cada proveedor, ya pedidos (sirven de sugerencias al elegir uno). */
  models: Partial<Record<AiProviderId, string[]>>;
  /** Modelos pedidos con la clave que se está escribiendo (la clave no se conserva aquí). */
  typedModels: Partial<Record<AiProviderId, TypedKeyModels>>;
  /** Proveedor que se está guardando o probando ahora mismo. */
  busy: { id: AiProviderId; action: 'save' | 'test' } | null;
  testResult: AiTestResult | null;
  /** Último error al guardar un proveedor (`ai.storage`…); `null` si no hubo. */
  saveError: { id: AiProviderId; code: string } | null;
  load: () => Promise<void>;
  /** Devuelve si se guardó. La clave sale de aquí hacia Rust y no se conserva. */
  save: (id: AiProviderId, input: AiSaveInput) => Promise<boolean>;
  setActive: (id: AiProviderId | null) => Promise<void>;
  test: (id: AiProviderId) => Promise<void>;
  loadModels: (id: AiProviderId) => Promise<void>;
  /** Pide los modelos con la clave escrita (sin guardarla), para poder elegir uno antes de guardar. */
  previewModels: (id: AiProviderId, apiKey: string) => Promise<void>;
  /** Olvida los modelos pedidos con una clave escrita (se borró la clave o ya se guardó). */
  clearPreview: (id: AiProviderId) => void;
  /** Le hace una pregunta escrita al proveedor activo; la respuesta sale en la isla. */
  ask: (question: string) => Promise<void>;
}

export const useAiStore = create<AiStore>((set, get) => ({
  status: null,
  models: {},
  typedModels: {},
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
      set((state) => ({
        status,
        models: { ...state.models, [id]: undefined },
        typedModels: { ...state.typedModels, [id]: undefined },
      }));
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

  ask: async (question) => {
    try {
      await commands.aiAsk(question);
    } catch {
      // Si no se pudo enviar, la isla no mostrará nada: no hay otra cosa que hacer aquí.
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

  previewModels: async (id, apiKey) => {
    const seq = (previewSeq[id] ?? 0) + 1;
    previewSeq[id] = seq;
    set((state) => ({
      typedModels: {
        ...state.typedModels,
        [id]: { state: 'loading', models: state.typedModels[id]?.models ?? [], code: null },
      },
    }));
    let next: TypedKeyModels;
    try {
      next = { state: 'ready', models: await commands.aiListModels(id, apiKey), code: null };
    } catch (error) {
      next = { state: 'error', models: [], code: commandErrorCode(error) ?? 'unknown' };
    }
    // Si mientras tanto se siguió escribiendo (otra petición) o se borró la clave, esta ya no vale.
    if (previewSeq[id] !== seq) return;
    set((state) => ({ typedModels: { ...state.typedModels, [id]: next } }));
  },

  clearPreview: (id) => {
    previewSeq[id] = (previewSeq[id] ?? 0) + 1;
    set((state) =>
      state.typedModels[id] === undefined
        ? state
        : { typedModels: { ...state.typedModels, [id]: undefined } },
    );
  },
}));
