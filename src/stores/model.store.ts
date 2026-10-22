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
  /** El modelo se está moviendo a otra carpeta (son cientos de MB: tarda unos segundos). */
  movingDir: boolean;
  download: () => Promise<void>;
  cancel: () => Promise<void>;
  remove: () => Promise<void>;
  /** Abre el selector de carpetas del sistema (con ese título) y mueve el modelo a la elegida. */
  chooseDir: (title: string) => Promise<void>;
  /** Devuelve el modelo a la carpeta de la app. */
  resetDir: () => Promise<void>;
  /** Pide el estado y se suscribe a sus cambios (progreso de la descarga). Devuelve cómo desuscribirse. */
  bind: () => Promise<() => void>;
}

export const useModelStore = create<ModelStore>((set) => ({
  status: null,
  errorCode: null,
  movingDir: false,

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

  chooseDir: async (title) => {
    set({ errorCode: null, movingDir: true });
    try {
      const status = await commands.sttModelChooseDir(title);
      if (status) set({ status });
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    } finally {
      set({ movingDir: false });
    }
  },

  resetDir: async () => {
    set({ errorCode: null, movingDir: true });
    try {
      set({ status: await commands.sttModelResetDir() });
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    } finally {
      set({ movingDir: false });
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
