import type { ComponentType } from 'react';

/**
 * Punto de extensión de la isla (§4.3). Añadir un módulo = crear una carpeta en `modules/`
 * y registrarlo; `Island.tsx` no se toca.
 */
export interface OrbitModule {
  id: string;
  name: string;
  icon: ComponentType;
  /** Arbitraje cuando hay varias actividades: gana la de mayor prioridad. */
  priority: number;
  /** Vista pastilla. */
  Compact: ComponentType;
  /** Vista tarjeta. */
  Expanded: ComponentType;
  onActivate?(): void;
  onDeactivate?(): void;
}
