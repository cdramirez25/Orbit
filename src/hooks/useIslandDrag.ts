import { useRef, type PointerEvent } from 'react';

import { commands } from '@/ipc/commands';
import { useIslandStore } from '@/stores/island.store';
import type { Point } from '@/types';

/** Cuánto hay que mover el puntero antes de considerarlo arrastre (y no un clic). */
const DRAG_THRESHOLD_PX = 4;
/** Los controles dentro de la isla siguen siendo clicables: no inician un arrastre. */
const INTERACTIVE = 'button, a, [role="switch"], [role="tab"], [role="slider"]';

interface DragSession {
  startX: number;
  startY: number;
  /** Esquina de la ventana al empezar (llega de Rust, de forma asíncrona). */
  origin: Point | null;
  active: boolean;
  latest: Point | null;
  frame: number | null;
}

/**
 * Arrastrar y soltar la isla (modo libre). Se mueve la ventana nativa con las coordenadas de
 * pantalla del puntero (no cambian aunque la ventana se mueva), un comando por frame como máximo.
 * Al soltar se guarda la posición. Un movimiento corto sigue siendo un clic.
 */
export function useIslandDrag(enabled: boolean) {
  const session = useRef<DragSession | null>(null);
  const justDragged = useRef(false);

  const send = (s: DragSession, commit: boolean) => {
    if (s.latest) void commands.setIslandOrigin(s.latest.x, s.latest.y, commit);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return;
    if ((event.target as Element).closest(INTERACTIVE)) return;

    const s: DragSession = {
      startX: event.screenX,
      startY: event.screenY,
      origin: null,
      active: false,
      latest: null,
      frame: null,
    };
    session.current = s;
    void commands.getIslandOrigin().then((origin) => {
      s.origin = origin;
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const s = session.current;
    if (!s) return;

    const dx = event.screenX - s.startX;
    const dy = event.screenY - s.startY;
    if (!s.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      s.active = true;
      useIslandStore.getState().setDragging(true);
    }
    if (!s.origin) return;

    s.latest = { x: s.origin.x + dx, y: s.origin.y + dy };
    s.frame ??= requestAnimationFrame(() => {
      s.frame = null;
      send(s, false);
    });
  };

  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const s = session.current;
    session.current = null;
    if (!s) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!s.active) return;

    if (s.frame !== null) cancelAnimationFrame(s.frame);
    send(s, true);
    useIslandStore.getState().setDragging(false);

    // El `click` que sigue a soltar no debe expandir la isla.
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 50);
  };

  /** `true` si el clic que llega es el final de un arrastre (y hay que ignorarlo). */
  const consumeClick = (): boolean => {
    const was = justDragged.current;
    justDragged.current = false;
    return was;
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    consumeClick,
  };
}
