import type { IslandAnchor, Point } from '@/types/island';

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
}
