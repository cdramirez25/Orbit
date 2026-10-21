import { useEffect } from 'react';

import { commands } from '@/ipc/commands';
import { useIslandStore } from '@/stores/island.store';

/** Atributo que marca los rectángulos que capturan el mouse (la isla y los controles de demo). */
export const HIT_TARGET_ATTR = 'data-hit-target';

const POLL_MS = 24;
const MARGIN_PX = 3;

function isOverTarget(x: number, y: number): boolean {
  for (const el of document.querySelectorAll(`[${HIT_TARGET_ATTR}]`)) {
    const r = el.getBoundingClientRect();
    if (
      x >= r.left - MARGIN_PX &&
      x <= r.right + MARGIN_PX &&
      y >= r.top - MARGIN_PX &&
      y <= r.bottom + MARGIN_PX
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Click-through dinámico (§3.3). La ventana ignora el mouse por defecto, así que el webview no
 * recibe `mousemove`: se consulta la posición global del puntero a Rust y solo se captura el
 * mouse (`set_island_interactive`) mientras esté sobre la isla. También alimenta el hover.
 */
export function useHitTest(): void {
  useEffect(() => {
    let alive = true;
    let interactive = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const p = await commands.getPointerPosition();
        // Mientras se arrastra la isla el puntero puede ir un paso por detrás: no soltar el mouse.
        const over = useIslandStore.getState().dragging || (p !== null && isOverTarget(p.x, p.y));

        if (over !== interactive) {
          interactive = over;
          await commands.setIslandInteractive(over);
        }

        const { snapshot, send } = useIslandStore.getState();
        const islandEl = document.querySelector('[data-island]');
        const overIsland =
          over && p !== null && islandEl !== null && rectContains(islandEl, p.x, p.y);
        if (overIsland !== snapshot.hovered) {
          send({ type: overIsland ? 'POINTER_ENTER' : 'POINTER_LEAVE' });
        }
      } catch {
        // Si falla una consulta puntual, el siguiente ciclo lo reintenta.
      }
      if (alive) timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      void commands.setIslandInteractive(false);
    };
  }, []);
}

function rectContains(el: Element, x: number, y: number): boolean {
  const r = el.getBoundingClientRect();
  return (
    x >= r.left - MARGIN_PX &&
    x <= r.right + MARGIN_PX &&
    y >= r.top - MARGIN_PX &&
    y <= r.bottom + MARGIN_PX
  );
}
