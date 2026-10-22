import type { Transition } from 'motion/react';

import type { ExpandedSize, IslandAnchor, IslandState, IslandStyle, NotchInfo } from '@/types';

/**
 * ÚNICA fuente de constantes de animación y de forma de la isla (§3.2). Se ajustan a ojo aquí
 * y nada más; los valores finales se documentan en docs/ANIMATION.md.
 */

/** Tamaño de la ventana nativa (fijo, nunca se anima). Debe coincidir con `window::island_window`. */
export const WINDOW = { width: 640, height: 520 } as const;

/**
 * Springs. `visualDuration` ≈ "respuesta" de 0.35 s; `bounce` = 1 − amortiguación.
 * bounce 0.28 → amortiguación ≈ 0.72 → overshoot ≈ 4 % (objetivo: 3–6 %).
 */
export const SPRING = {
  container: { type: 'spring', visualDuration: 0.35, bounce: 0.28 },
  hover: { type: 'spring', visualDuration: 0.18, bounce: 0.2 },
  /** Reposicionamiento vertical al cambiar attached ⇄ floating. */
  position: { type: 'spring', visualDuration: 0.3, bounce: 0.15 },
} as const satisfies Record<string, Transition>;

/** Contenido: al expandir aparece con retraso; al contraer se desvanece antes de que el contenedor se mueva. */
export const CONTENT = {
  enterDelay: 0.08, // 60–100 ms
  enterDuration: 0.22,
  exitDuration: 0.1,
  blurPx: 6,
  scaleFrom: 0.96,
  ease: [0.22, 1, 0.36, 1],
} as const;

/** `prefers-reduced-motion`: sin springs, solo fundidos de 120 ms. */
export const REDUCED_MOTION = { fadeDuration: 0.12 } as const;

/** Hover en `idle`: crece ~4–8 % de ancho. */
export const HOVER = { scaleX: 1.06 } as const;

/** Ondas de la pastilla: barras que siguen el volumen (escuchar) o laten con la música. */
export const WAVES = {
  /** Alto mínimo de una barra en silencio (fracción del alto total). */
  minScale: 0.2,
  /** Cuánto responde cada barra al volumen: la del centro es la más viva. */
  weights: [0.7, 1, 0.85, 0.55],
  /** El volumen típico de música o voz ronda 0.5–0.8; se amplifica un poco para que se note. */
  gain: 1.25,
  /** Con movimiento reducido las barras se quedan a esta altura, sin animarse. */
  reducedLevel: 0.5,
} as const;

/**
 * Cámara: al encenderla, la vista previa entra con un fundido y un pequeño crecimiento (la isla ya
 * crece sola con el resorte del contenedor, porque el contenido se hace más alto), y al tomar la
 * foto un destello blanco cubre la imagen un momento.
 */
export const CAMERA = {
  /** Lado de la vista previa cuadrada (px). */
  previewSize: 176,
  /** La vista previa entra desde esta escala. */
  previewScaleFrom: 0.92,
  previewDuration: 0.28,
  /** El destello al disparar: opacidad máxima y lo que tarda en desvanecerse. */
  flashOpacity: 0.85,
  flashDuration: 0.28,
} as const;

export const SHAPE = {
  /** Margen superior en estilo `floating` (8–10 px). */
  floatingMarginTop: 9,
  /** Separación al borde de la pantalla en las anclas izquierda y derecha. */
  edgeMargin: 16,
  /** Radio de las "orejas" (curvas inversas) en estilo `attached`. */
  earRadius: 12,
  /** Medidas de notch ficticio cuando se pide `attached` en una pantalla sin notch. */
  notchFallback: { width: 180, height: 32 },
  /** Radio de las esquinas inferiores por estado (≈18 compact → ≈28 expanded). */
  radius: { idle: 15, compact: 18, alert: 22, expanded: 28, fusedWithNotch: 10 },
} as const;

export const SIZE = {
  floating: {
    idle: { width: 132, height: 30 },
    compact: { width: 224, height: 38 },
    alert: { width: 360, height: 64 },
  },
  attached: {
    /** Ancho extra a cada lado del notch en `compact` (ahí viven el punto y las ondas). */
    compactWing: 70,
    alertWidth: 380,
    /** Alto del `alert` por debajo de la franja del notch. */
    alertExtraHeight: 48,
  },
  expanded: {
    width: 520,
    minHeight: 120,
    /**
     * Tope de altura del contenido (sin la franja del notch); lo que sobre hace scroll interno.
     * Incluye la fila del botón Alargar/Reducir (32 px). `normal` deja ver la tarjeta de IA completa
     * (sesión, grabar, campo para escribir y una respuesta de unas 3 líneas); `tall` da más sitio.
     */
    maxHeight: { normal: 268, tall: 380 },
  },
} as const;

/** Tope total de la tarjeta expandida: el contenido más la franja del notch (si es `attached`). */
export function expandedMaxHeight(size: ExpandedSize, topInset: number): number {
  return SIZE.expanded.maxHeight[size] + topInset;
}

/** Orden de "tamaño" de cada estado: sirve para saber si una transición contrae el contenedor. */
const STATE_RANK: Record<IslandState, number> = {
  hidden: 0,
  idle: 1,
  compact: 2,
  alert: 3,
  expanded: 4,
};

export function isShrinking(from: IslandState, to: IslandState): boolean {
  return STATE_RANK[to] < STATE_RANK[from];
}

export interface LayoutArgs {
  anchor: IslandAnchor;
  style: IslandStyle;
  notch: NotchInfo | null;
}

/**
 * Estilo y notch efectivos según dónde esté la isla. Solo en el centro está sobre el notch real
 * (izquierda, derecha y libre se comportan como una pantalla sin notch); en modo libre puede estar
 * lejos del borde, así que siempre flota.
 */
export function resolveLayout({ anchor, style, notch }: LayoutArgs): {
  style: IslandStyle;
  notch: NotchInfo | null;
} {
  return {
    style: anchor === 'free' ? 'floating' : style,
    notch: anchor === 'center' ? notch : null,
  };
}

export interface ResolveArgs {
  state: IslandState;
  hovered: boolean;
  style: IslandStyle;
  notch: NotchInfo | null;
  /** Alto natural medido del contenido expandido (incluye el inset del notch). */
  contentHeight: number;
  /** Tarjeta normal o alargada (por defecto, normal). */
  expandedSize?: ExpandedSize;
}

export interface IslandTarget {
  width: number;
  height: number;
  topRadius: number;
  bottomRadius: number;
  opacity: number;
  /** Espacio reservado arriba para no tapar el contenido con el notch (solo `attached`). */
  topInset: number;
  /** ¿Fundida con el notch real? (idle/hidden en un Mac con notch.) */
  fused: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Dimensiones objetivo del contenedor para un estado. Pura: se testea sin DOM. */
export function resolveIslandTarget({
  state,
  hovered,
  style,
  notch,
  contentHeight,
  expandedSize = 'normal',
}: ResolveArgs): IslandTarget {
  const attached = style === 'attached';
  const realNotch = notch?.hasNotch === true;
  const notchWidth = realNotch ? notch.notchWidth : SHAPE.notchFallback.width;
  const notchHeight = realNotch ? notch.notchHeight : SHAPE.notchFallback.height;
  const fusedWithNotch = attached && realNotch;

  let width: number;
  let height: number;
  let bottomRadius: number;
  let opacity = 1;
  let topInset = 0;

  switch (state) {
    case 'hidden':
    case 'idle': {
      width = attached ? notchWidth : SIZE.floating.idle.width;
      height = attached ? notchHeight : SIZE.floating.idle.height;
      bottomRadius = fusedWithNotch ? SHAPE.radius.fusedWithNotch : SHAPE.radius.idle;
      // Oculta del todo, salvo que esté fundida con el notch (negro sobre negro).
      if (state === 'hidden' && !fusedWithNotch) opacity = 0;
      if (state === 'idle' && hovered) width *= HOVER.scaleX;
      break;
    }
    case 'compact': {
      width = attached ? notchWidth + SIZE.attached.compactWing * 2 : SIZE.floating.compact.width;
      height = attached ? notchHeight : SIZE.floating.compact.height;
      bottomRadius = SHAPE.radius.compact;
      break;
    }
    case 'alert': {
      width = attached ? SIZE.attached.alertWidth : SIZE.floating.alert.width;
      height = attached ? notchHeight + SIZE.attached.alertExtraHeight : SIZE.floating.alert.height;
      bottomRadius = SHAPE.radius.alert;
      topInset = attached ? notchHeight : 0;
      break;
    }
    case 'expanded': {
      width = SIZE.expanded.width;
      topInset = attached ? notchHeight : 0;
      height = clamp(
        contentHeight,
        SIZE.expanded.minHeight,
        expandedMaxHeight(expandedSize, topInset),
      );
      bottomRadius = SHAPE.radius.expanded;
      break;
    }
  }

  bottomRadius = Math.min(bottomRadius, height / 2);

  return {
    width,
    height,
    topRadius: attached ? 0 : bottomRadius,
    bottomRadius,
    opacity,
    topInset,
    fused: fusedWithNotch && (state === 'idle' || state === 'hidden'),
  };
}
