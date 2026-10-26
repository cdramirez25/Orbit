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
  /** Un video: ¿trae pista de sonido? `null` si es una imagen o no se pudo saber. */
  hasAudio: boolean | null;
}

/** Lo que le toca a un monitor. Espejo de `ScreenStatus` en Rust. */
export interface WallpaperScreen {
  /** Nombre único del monitor (el del sistema); con él se guarda lo elegido para ese monitor. */
  key: string;
  /** El nombre que el sistema le da para mostrarlo (`null` si no lo dice). */
  label: string | null;
  /** Archivo que le toca (el suyo o el de todos). */
  file: string | null;
  kind: WallpaperKind | null;
  /** Ruta completa del archivo, si sigue en la carpeta. */
  path: string | null;
  /** Lo que se pidió para este monitor: ¿con sonido? */
  sound: boolean;
  /** ¿Trae audio el video? `null` si es una imagen o no se sabe. */
  hasAudio: boolean | null;
  /** ¿Suena de verdad ahora? (Pidió sonido, el video tiene audio y no suena ya en otro monitor.) */
  audible: boolean;
  /** El archivo que le toca ya no está en la carpeta. */
  missing: boolean;
  /** ¿Está en pausa por el modo rendimiento? */
  paused: boolean;
}

/** Espejo de `WallpaperStatus` en Rust: lo que ven las ventanas de fondo y la página de Ajustes. */
export interface WallpaperStatus {
  enabled: boolean;
  /** Archivo elegido para todos los monitores. */
  file: string | null;
  /** ¿Suena? Para todos los monitores. */
  sound: boolean;
  /** Volumen de los videos con sonido, de 0 a 100. */
  volume: number;
  /** Pausa a mano. */
  manualPause: boolean;
  performance: PerformanceMode;
  /** ¿Cada monitor tiene su fondo? (Si no, el mismo en todos.) */
  perScreen: boolean;
  /** Los monitores conectados, en el orden de sus ventanas. */
  screens: WallpaperScreen[];
  /** La carpeta donde se ponen los fondos. */
  folder: string;
  /** Código del último fallo al mostrar el fondo (`wallpaper.*`); `null` si no hubo. */
  error: string | null;
}
