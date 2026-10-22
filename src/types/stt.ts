/** Idioma de la transcripción: detectarlo en cada frase o uno fijo. Espejo de `SttLanguage` en Rust. */
export type SttLanguage = 'auto' | 'es' | 'en';

/** Los modelos de voz que se pueden elegir. Espejo de `SttModel` en Rust (`stt/catalog.rs`). */
export type SttModel = 'base' | 'small' | 'medium' | 'turbo';

export type ModelState = 'missing' | 'downloading' | 'ready';

/** Un modelo de voz tal como está en disco. Espejo de `ModelEntry` en Rust (`stt/model.rs`). */
export interface ModelEntry {
  model: SttModel;
  state: ModelState;
  /** Bytes descargados hasta ahora. */
  downloaded: number;
  /** Tamaño del modelo en bytes. */
  total: number;
  /** Código del último fallo de su descarga (`stt.model.*`); `null` si no hubo. */
  error: string | null;
}

/** Espejo de `ModelStatus` en Rust: los modelos de voz y cuál se usa. */
export interface ModelStatus {
  /** El que usa el motor de transcripción. */
  active: SttModel;
  /** Todos los que se ofrecen, de menor a mayor capacidad. */
  models: ModelEntry[];
  /** Carpeta donde están (o estarán) los modelos. */
  dir: string;
  /** ¿La eligió el usuario (y no es la de la app)? */
  customDir: boolean;
}
