import type { KeepAwakeStatus } from './awake';
import type { NowPlaying } from './media';
import type { UiAction } from './shortcuts';
import type { ModelStatus } from './stt';
import type { WallpaperStatus } from './wallpaper';

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

/** Empieza la respuesta a una pregunta detectada en lo que se dijo. */
export interface LlmStart {
  question: string;
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
  'llm:start': LlmStart;
  'llm:delta': LlmDelta;
  'llm:done': null;
  /** El historial del portapapeles cambió: hay que volver a pedirlo. */
  'clipboard:changed': null;
  /** Cambiaron las sesiones o su historial: hay que volver a pedirlos. */
  'sessions:changed': null;
  /** Cambió lo que suena (`null`: ya no suena nada). */
  'media:changed': NowPlaying | null;
  /** Cambió el modelo de transcripción: descargando (con progreso), descargado, borrado o con un fallo. */
  'stt:model': ModelStatus;
  /** Un atajo global o la bandeja piden algo a la isla. */
  'ui:action': UiAction;
  /** Cambió el modo de pantalla encendida, o empezó o terminó (se acabó el tiempo, el horario…). */
  'awake:changed': KeepAwakeStatus;
  /** Cambió el fondo de pantalla: otro archivo, una pausa, o empezó o terminó una pausa por rendimiento. */
  'wallpaper:changed': WallpaperStatus;
  error: OrbitError;
}

export type PipelineEventName = keyof PipelineEvents;
