/** Idioma de la transcripción: detectarlo en cada frase o uno fijo. Espejo de `SttLanguage` en Rust. */
export type SttLanguage = 'auto' | 'es' | 'en';

export type ModelState = 'missing' | 'downloading' | 'ready';

/** Espejo de `ModelStatus` en Rust (`stt/model.rs`): el modelo de transcripción en disco. */
export interface ModelStatus {
  state: ModelState;
  /** Bytes descargados hasta ahora. */
  downloaded: number;
  /** Tamaño del modelo en bytes. */
  total: number;
  /** Código del último fallo de la descarga (`stt.model.*`); `null` si no hubo. */
  error: string | null;
}
