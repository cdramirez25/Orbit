import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import { onEvent } from '@/ipc/events';
import type { ModelStatus, SttModel } from '@/types';

interface ModelStore {
  /** Los modelos de transcripción en disco y cuál se usa; `null` = todavía no se ha consultado. */
  status: ModelStatus | null;
  /** Código del último fallo de una orden (borrar, descargar); `null` si no hubo. */
  errorCode: string | null;
  /** Los modelos se están moviendo a otra carpeta (son cientos de MB: tarda unos segundos). */
  movingDir: boolean;
  /** Baja un modelo; al terminar, Rust lo deja como el que se usa. */
  download: (model: SttModel) => Promise<void>;
  cancel: () => Promise<void>;
  remove: (model: SttModel) => Promise<void>;
  /** Elige cuál de los modelos descargados se usa. */
  use: (model: SttModel) => Promise<void>;
  /** Abre el selector de carpetas del sistema (con ese título) y mueve los modelos a la elegida. */
  chooseDir: (title: string) => Promise<void>;
  /** Devuelve los modelos a la carpeta de la app. */
  resetDir: () => Promise<void>;
  /** Pide el estado y se suscribe a sus cambios (progreso de la descarga). Devuelve cómo desuscribirse. */
  bind: () => Promise<() => void>;
}

export const useModelStore = create<ModelStore>((set) => ({
  status: null,
  errorCode: null,
  movingDir: false,

  download: async (model) => {
    set({ errorCode: null });
    try {
      await commands.sttModelDownload(model);
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

  remove: async (model) => {
    set({ errorCode: null });
    try {
      await commands.sttModelRemove(model);
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    }
  },

  use: async (model) => {
    set({ errorCode: null });
    try {
      set({ status: await commands.sttModelUse(model) });
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
