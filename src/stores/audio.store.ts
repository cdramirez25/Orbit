import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import { onEvent } from '@/ipc/events';
import { audioLevel } from '@/lib/audio/audio-level';
import type { PermissionStatus } from '@/types';

interface AudioStore {
  /** Permiso para capturar el audio del sistema; `null` = todavía no se ha consultado. */
  permission: PermissionStatus | null;
  /** Vuelve a consultar el estado (por ejemplo, cuando el usuario vuelve de Ajustes del Sistema). */
  refresh: () => Promise<void>;
  /** Pide el permiso: el aviso del sistema sale solo la primera vez. */
  request: () => Promise<void>;
  /** Abre la pantalla de Ajustes del Sistema donde se concede. */
  openSettings: () => Promise<void>;

  /** ¿Se está escuchando el audio del sistema? */
  listening: boolean;
  /** Código del último error al escuchar (para elegir el mensaje); `null` si no hay. */
  errorCode: string | null;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  toggleListening: () => Promise<void>;
  /**
   * Enlaza con los eventos de Rust (volumen y estado) y con el estado actual. Devuelve la
   * función que los desenlaza. Se llama una vez, al arrancar la ventana.
   */
  bind: () => Promise<() => void>;
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  permission: null,

  refresh: async () => {
    try {
      set({ permission: await commands.getAudioPermission() });
    } catch {
      // Se conserva el último estado conocido; la siguiente consulta lo reintenta.
    }
  },

  request: async () => {
    try {
      set({ permission: await commands.requestAudioPermission() });
    } catch {
      // Sin respuesta del sistema: se queda como estaba.
    }
  },

  openSettings: async () => {
    try {
      await commands.openAudioPermissionSettings();
    } catch {
      // No se pudo abrir Ajustes; el usuario puede ir a mano (Privacidad y seguridad).
    }
  },

  listening: false,
  errorCode: null,

  startListening: async () => {
    set({ errorCode: null });
    // La primera vez, antes de escuchar se pide el permiso (sale el aviso del sistema).
    if (get().permission === 'notDetermined') await get().request();
    try {
      await commands.startListening();
      set({ listening: true });
    } catch (error) {
      set({ listening: false, errorCode: commandErrorCode(error) ?? 'unknown' });
      await get().refresh(); // quizá el fallo es justo que falta el permiso
    }
  },

  stopListening: async () => {
    try {
      await commands.stopListening();
    } catch {
      // Aunque falle, la interfaz deja de mostrar "escuchando".
    }
    set({ listening: false });
    audioLevel.set(0);
  },

  toggleListening: async () => {
    if (get().listening) await get().stopListening();
    else await get().startListening();
  },

  bind: async () => {
    const unlisten = await Promise.all([
      onEvent('audio:level', (level) => audioLevel.set(level)),
      onEvent('pipeline:state', (state) =>
        set({
          listening: state === 'listening',
          ...(state === 'listening' ? { errorCode: null } : {}),
        }),
      ),
      onEvent('error', (error) => set({ errorCode: error.code })),
    ]);

    // Si ya estaba escuchando antes de que la interfaz cargara (por ejemplo, un reinicio de la
    // ventana), se refleja.
    try {
      if (await commands.isListening()) set({ listening: true });
    } catch {
      // Sin respuesta: se queda en "no escuchando".
    }

    return () => unlisten.forEach((off) => off());
  },
}));
