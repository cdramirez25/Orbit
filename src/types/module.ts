import type { ComponentType } from 'react';

import type { MessageKey } from '@/i18n/messages';

/**
 * Punto de extensión de la isla (§4.3). Añadir un módulo = crear una carpeta en `modules/`
 * y registrarlo; `Island.tsx` no se toca.
 */
export interface OrbitModule {
  id: string;
  /** Clave del texto con el nombre del módulo (selector de módulos y accesibilidad). */
  labelKey: MessageKey;
  /** Icono del módulo en el selector (un componente de `lucide-react`, nunca un emoji). */
  icon: ComponentType;
  /** Arbitraje cuando hay varias actividades: gana la de mayor prioridad. */
  priority: number;
  /**
   * Módulo residente: siempre disponible en la isla (clima, portapapeles…). El usuario elige
   * cuál ver con el selector de la tarjeta expandida; una actividad de mayor prioridad
   * (por ejemplo, escuchar) lo desplaza mientras dure.
   */
  ambient?: boolean;
  /**
   * El contenido crece por abajo (texto en streaming): al crecer, el scroll interno sigue al
   * final. Sin esto el scroll se queda donde está (listas que crecen por arriba).
   */
  followEnd?: boolean;
  /** Vista pastilla. */
  Compact: ComponentType;
  /** Vista tarjeta. */
  Expanded: ComponentType;
  onActivate?(): void;
  onDeactivate?(): void;
}
