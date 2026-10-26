import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { commandErrorCode } from '@/ipc/errors';
import { onEvent } from '@/ipc/events';
import { screenIndexOf, screenOf } from '@/lib/wallpaper';
import type { PerformanceMode, WallpaperItem, WallpaperStatus } from '@/types';

/** Un archivo de la carpeta con la dirección para cargarlo en esta ventana. */
export interface WallpaperEntry extends WallpaperItem {
  url: string;
}

interface WallpaperStore {
  /** Cómo está el fondo; `null` = todavía no se ha consultado. */
  status: WallpaperStatus | null;
  /** Dirección para cargar el archivo que le toca a esta ventana; `null` si no hay. */
  url: string | null;
  /** Qué monitor es esta ventana (solo en las ventanas de fondo; 0 en las demás). */
  screen: number;
  /** Los archivos de la carpeta de fondos. */
  items: WallpaperEntry[];
  /** Código del último fallo de una orden (`wallpaper.*`); `null` si no hubo. */
  errorCode: string | null;
  /** Una orden de copiar archivos está en marcha. */
  adding: boolean;
  /** Vuelve a leer la carpeta (por si el usuario puso o quitó archivos). */
  refresh: () => Promise<void>;
  /** Elige un archivo como fondo y lo muestra: en todos los monitores o solo en `screen`. */
  select: (file: string, screen?: string | null) => Promise<void>;
  /** Activa o quita el sonido de los videos: en todos los monitores o solo en `screen`. */
  setSound: (sound: boolean, screen?: string | null) => Promise<void>;
  /** Volumen de los videos con sonido, de 0 a 100. */
  setVolume: (volume: number) => Promise<void>;
  /** El mismo fondo en todos los monitores (`false`) o uno distinto en cada uno (`true`). */
  setPerScreen: (perScreen: boolean) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  setPerformance: (mode: PerformanceMode) => Promise<void>;
  openFolder: () => Promise<void>;
  /** Abre el selector de archivos del sistema (con ese título) y copia lo que se elija a la carpeta. */
  addFiles: (title: string) => Promise<void>;
  /** Una ventana de fondo pide que su video se ponga a reproducir (ver `commands.wallpaperPlay`). */
  requestPlay: () => Promise<void>;
  /** Pide el estado y se suscribe a sus cambios (pausas por rendimiento incluidas). */
  bind: () => Promise<() => void>;
}

const entriesOf = (items: WallpaperItem[]): WallpaperEntry[] =>
  items.map((item) => ({ ...item, url: commands.fileUrl(item.path) }));

export const useWallpaperStore = create<WallpaperStore>((set, get) => {
  /** Guarda el estado y la dirección del archivo que le toca a esta ventana (su monitor). */
  const apply = (status: WallpaperStatus) => {
    const path = screenOf(status, get().screen)?.path ?? null;
    set({ status, url: path ? commands.fileUrl(path) : null });
  };

  /** Corre una orden que devuelve el estado nuevo; si falla, guarda su código. */
  const run = async (order: () => Promise<WallpaperStatus>) => {
    set({ errorCode: null });
    try {
      apply(await order());
    } catch (error) {
      set({ errorCode: commandErrorCode(error) ?? 'unknown' });
    }
  };

  return {
    status: null,
    url: null,
    screen: 0,
    items: [],
    errorCode: null,
    adding: false,

    refresh: async () => {
      try {
        set({ items: entriesOf(await commands.wallpaperList()) });
      } catch {
        // Se conserva la lista de antes; la siguiente vez que se abra la página se vuelve a pedir.
      }
    },

    select: (file, screen = null) => run(() => commands.wallpaperSelect(file, screen)),
    setSound: (sound, screen = null) => run(() => commands.wallpaperSetSound(sound, screen)),
    setVolume: (volume) => run(() => commands.wallpaperSetVolume(volume)),
    setPerScreen: (perScreen) => run(() => commands.wallpaperSetPerScreen(perScreen)),
    setEnabled: (enabled) => run(() => commands.wallpaperSetEnabled(enabled)),
    setPaused: (paused) => run(() => commands.wallpaperSetPaused(paused)),
    setPerformance: (mode) => run(() => commands.wallpaperSetPerformance(mode)),

    openFolder: async () => {
      set({ errorCode: null });
      try {
        await commands.wallpaperOpenFolder();
      } catch (error) {
        set({ errorCode: commandErrorCode(error) ?? 'unknown' });
      }
    },

    addFiles: async (title) => {
      set({ errorCode: null, adding: true });
      try {
        set({ items: entriesOf(await commands.wallpaperAddFiles(title)) });
      } catch (error) {
        set({ errorCode: commandErrorCode(error) ?? 'unknown' });
      } finally {
        set({ adding: false });
      }
    },

    requestPlay: async () => {
      try {
        await commands.wallpaperPlay();
      } catch {
        // Si no se pudo, el video se queda en su primer cuadro hasta el siguiente cambio.
      }
    },

    bind: async () => {
      const label = commands.currentWindowLabel();
      if (label) set({ screen: screenIndexOf(label) });
      const off = await onEvent('wallpaper:changed', apply);
      try {
        apply(await commands.wallpaperStatus());
      } catch {
        // Sin estado se queda en `null`: el fondo se queda apagado.
      }
      return off;
    },
  };
});
