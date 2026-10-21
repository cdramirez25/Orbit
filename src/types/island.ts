/** Estados de la isla (§3.1). */
export type IslandState = 'hidden' | 'idle' | 'compact' | 'expanded' | 'alert';

/** Estados "de reposo": aquellos a los que se vuelve al terminar un `alert`. */
export type RestingState = 'idle' | 'compact' | 'expanded';

/** `attached`: pegada al borde superior (con orejas). `floating`: pastilla con margen. */
export type IslandStyle = 'attached' | 'floating';

/**
 * Tamaño de la tarjeta expandida: `normal` ≈ 4 filas de respuesta; `tall` ≈ 8 (botón "Alargar").
 * Es una variante de visualización de `expanded`, no un estado de la máquina.
 */
export type ExpandedSize = 'normal' | 'tall';

export interface ScreenFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Espejo de `window::notch::NotchInfo` (Rust). Medidas en puntos lógicos. */
export interface NotchInfo {
  hasNotch: boolean;
  notchWidth: number;
  notchHeight: number;
  screenFrame: ScreenFrame;
}

/**
 * Dónde se coloca la isla en la pantalla (espejo de `IslandAnchor` en Rust).
 * `center` es automático: detecta el tamaño del monitor y se recentra sola si cambia.
 * `free`: donde el usuario la arrastre y la suelte.
 */
export type IslandAnchor = 'left' | 'center' | 'right' | 'free';

/** Punto en px / puntos lógicos. */
export interface Point {
  x: number;
  y: number;
}

/** Posición del puntero en px lógicos respecto a la esquina superior izquierda de la ventana. */
export type PointerPosition = Point;

/** Contenido de un `alert` (notificación breve). */
export interface IslandAlert {
  title: string;
  message?: string;
}
