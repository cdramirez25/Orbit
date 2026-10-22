/** Espejo de `src-tauri/src/ai/mod.rs`: lo que la interfaz sabe de los proveedores de IA. */

export type AiProviderId = 'claude' | 'chatgpt' | 'groq' | 'gemini' | 'ollama' | 'docker';

export interface AiProviderStatus {
  id: AiProviderId;
  /** Dirección guardada (solo los proveedores locales). */
  baseUrl: string | null;
  model: string | null;
  /** Modelo que se usa si no se elige uno. */
  defaultModel: string | null;
  /** ¿Hay una clave guardada? La clave en sí nunca llega a la interfaz. */
  hasKey: boolean;
}

export interface AiStatus {
  /** El proveedor con el que responde Orbit; `null` si todavía no se eligió ninguno. */
  active: AiProviderId | null;
  providers: AiProviderStatus[];
}

/** Lo que se cambia al guardar un proveedor. Lo que no se pasa, no se toca. */
export interface AiSaveInput {
  /** Una clave nueva; vacía borra la guardada. */
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}
