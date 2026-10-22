import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import { onEvent } from '@/ipc/events';
import type { ModelStatus } from '@/types';

interface ModelStore {
  /** El modelo de transcripción en disco; `null` = todavía no se ha consultado. */
  status: ModelStatus | null;
  /** Código del último fallo de una orden (borrar, descargar); `null` si no hubo. */
  errorCode: string | null;
  download: () => Promise<void>;
  cancel: () => Promise<void>;
  remove: () => Promise<void>;
  /** Pide el estado y se suscribe a sus cambios (progreso de la descarga). Devuelve cómo desuscribirse. */
  bind: () => Promise<() => void>;
}

export const useModelStore = create<ModelStore>((set) => ({
  status: null,
  errorCode: null,

  download: async () => {
    set({ errorCode: null });
    try {
      await commands.sttModelDownload();
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    }
  },

  cancel: async () => {
    try {
      await commands.sttModelCancel();
    } catch {
      // La descarga sigue; el estado real llega por el evento.
    }
  },

  remove: async () => {
    set({ errorCode: null });
    try {
      await commands.sttModelRemove();
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    }
  },

  bind: async () => {
    const off = await onEvent('stt:model', (status) => set({ status, errorCode: null }));
    try {
      set({ status: await commands.sttModelStatus() });
    } catch {
      // Sin estado se queda en `null`: la página lo muestra como desconocido.
    }
    return off;
  },
}));
