import type { AiProviderId } from './ai';

/** Espejo de `src-tauri/src/sessions/mod.rs`: sesiones con su prompt y su historial. */

export interface Session {
  id: number;
  name: string;
  /** Instrucciones para la IA de esta sesión ("responde como un experto en…"). */
  prompt: string;
  /** ¿Contesta sola las preguntas que oiga? Por defecto no: se le pregunta con el botón. */
  autoAnswer: boolean;
  /** La IA de esta sesión; `null` = la que esté en uso en los ajustes. */
  provider: AiProviderId | null;
  /** Segundos Unix. */
  createdAt: number;
}

export interface SessionMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface SessionsState {
  /** La sesión con la que se pregunta; `null` si no hay ninguna. */
  active: number | null;
  /** De la más nueva a la más antigua. */
  sessions: Session[];
}

/** Lo que se cambia de una sesión; lo que no se pasa, no se toca. */
export interface SessionUpdate {
  name?: string;
  prompt?: string;
  autoAnswer?: boolean;
  /** La IA de la sesión; una cadena vacía la quita (vuelve a usar la de los ajustes). */
  provider?: AiProviderId | '';
}
