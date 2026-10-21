import type { NowPlaying } from './media';

/**
 * Espejo exacto de `src-tauri/src/events.rs` (eventos de dominio → eventos de Tauri).
 * Si cambias uno, cambia el otro. (Evaluar `tauri-specta` para generarlos.)
 */

export type PipelineState = 'idle' | 'listening' | 'thinking' | 'answering' | 'error';

export interface SttPartial {
  text: string;
}

export interface SttFinal {
  text: string;
  endOfUtterance: boolean;
}

export interface LlmDelta {
  text: string;
}

export interface OrbitError {
  code: string;
  message: string;
  recoverable: boolean;
}

/** Nombre del evento → tipo de su payload. */
export interface PipelineEvents {
  'pipeline:state': PipelineState;
  'audio:level': number;
  'stt:partial': SttPartial;
  'stt:final': SttFinal;
  'llm:delta': LlmDelta;
  'llm:done': null;
  /** El historial del portapapeles cambió: hay que volver a pedirlo. */
  'clipboard:changed': null;
  /** Cambió lo que suena (`null`: ya no suena nada). */
  'media:changed': NowPlaying | null;
  error: OrbitError;
}

export type PipelineEventName = keyof PipelineEvents;
