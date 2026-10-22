import type { IslandAnchor, Point } from '@/types/island';
import type { SttLanguage } from '@/types/stt';

/**
 * Espejo de `Settings` en Rust (`settings/mod.rs`): lo que se persiste en JSON. Subconjunto de la
 * Fase 1; el resto (proveedores STT/LLM, idioma, atajos…) llega en la Fase 5.
 */
export interface IslandSettings {
  /** Oculta la isla de la pantalla compartida (por defecto ON). */
  hideFromScreenShare: boolean;
  islandAnchor: IslandAnchor;
  /** Esquina superior izquierda de la ventana en modo libre. */
  freeOrigin: Point | null;
  /** Idioma de la transcripción. */
  sttLanguage: SttLanguage;
  /** ¿Ya terminó (o saltó) la guía de primer arranque? */
  onboardingDone: boolean;
}
