/** Qué es un archivo de la carpeta de fondos. Espejo de `MediaKind` en Rust (`wallpaper/mod.rs`). */
export type WallpaperKind = 'image' | 'video';

/**
 * Cuándo se pausa el fondo solo para ahorrar recursos: `off` nunca, `large` con una ventana grande o
 * a pantalla completa, `any` con cualquier ventana abierta.
 */
export type PerformanceMode = 'off' | 'large' | 'any';

/** Un archivo de la carpeta de fondos. */
export interface WallpaperItem {
  file: string;
  kind: WallpaperKind;
  /** Tamaño en bytes. */
  size: number;
  /** Ruta completa, para cargarlo. */
  path: string;
}

/** Espejo de `WallpaperStatus` en Rust: lo que ven las ventanas de fondo y la página de Ajustes. */
export interface WallpaperStatus {
  enabled: boolean;
  /** Nombre del archivo elegido. */
  file: string | null;
  kind: WallpaperKind | null;
  /** Ruta completa del archivo elegido, si sigue en la carpeta. */
  path: string | null;
  /** Pausa a mano. */
  manualPause: boolean;
  performance: PerformanceMode;
  /** Por monitor: ¿está en pausa por el modo rendimiento? */
  screenPaused: boolean[];
  /** El archivo elegido ya no está en la carpeta. */
  missing: boolean;
  /** La carpeta donde se ponen los fondos. */
  folder: string;
  /** Código del último fallo al mostrar el fondo (`wallpaper.*`); `null` si no hubo. */
  error: string | null;
}
