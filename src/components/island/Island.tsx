import { animate, motion, useMotionValue, type Transition } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { IslandContent } from '@/components/island/IslandContent';
import { NotchShape } from '@/components/island/NotchShape';
import { useIslandDrag } from '@/hooks/useIslandDrag';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import {
  CONTENT,
  isShrinking,
  resolveIslandTarget,
  resolveLayout,
  SHAPE,
  SIZE,
  SPRING,
} from '@/lib/island/island.motion';
import { cn } from '@/lib/utils/cn';
import { useIslandStore } from '@/stores/island.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { IslandState } from '@/types';

/** Texto accesible de la isla cuando es clicable, según su estado. */
const ARIA_LABEL: Partial<Record<IslandState, MessageKey>> = {
  idle: 'island.open',
  compact: 'island.expand',
  alert: 'island.dismissAlert',
};

/**
 * El único contenedor que morfa (§3.2): ancho, alto y radios con un spring. Los valores son
 * `MotionValue`s, así que Motion los escribe en el DOM frame a frame sin re-renderizar React.
 */
export function Island() {
  const t = useT();
  const state = useIslandStore((s) => s.snapshot.state);
  const hovered = useIslandStore((s) => s.snapshot.hovered);
  const rawNotch = useIslandStore((s) => s.notch);
  const send = useIslandStore((s) => s.send);
  const chosenStyle = useSettingsStore((s) => s.islandStyle);
  const anchor = useSettingsStore((s) => s.anchor);
  const reduced = useReducedMotion();
  const expandedSize = useIslandStore((s) => s.expandedSize);
  const drag = useIslandDrag(anchor === 'free');

  // Solo en el centro la isla está sobre el notch real; en modo libre siempre flota.
  const { style, notch } = resolveLayout({ anchor, style: chosenStyle, notch: rawNotch });

  const [contentHeight, setContentHeight] = useState<number>(SIZE.expanded.minHeight);
  const target = resolveIslandTarget({
    state,
    hovered,
    style,
    notch,
    contentHeight,
    expandedSize,
  });
  const marginTop = style === 'floating' ? SHAPE.floatingMarginTop : 0;

  const width = useMotionValue(target.width);
  const height = useMotionValue(target.height);
  const topRadius = useMotionValue(target.topRadius);
  const bottomRadius = useMotionValue(target.bottomRadius);
  const opacity = useMotionValue(target.opacity);
  const offsetY = useMotionValue(marginTop);

  const previous = useRef({ state, hovered });

  useEffect(() => {
    const before = previous.current;
    previous.current = { state, hovered };

    let transition: Transition;
    if (reduced) {
      // Sin springs: el tamaño salta y el contenido hace fundido de 120 ms.
      transition = { duration: 0 };
    } else if (before.state !== state) {
      // Al contraer, el contenido se desvanece primero y luego se mueve el contenedor.
      const delay = isShrinking(before.state, state) ? CONTENT.exitDuration : 0;
      transition = { ...SPRING.container, delay };
    } else if (before.hovered !== hovered) {
      transition = SPRING.hover;
    } else {
      transition = SPRING.container; // cambio de altura por contenido en streaming
    }

    animate(width, target.width, transition);
    animate(height, target.height, transition);
    animate(topRadius, target.topRadius, transition);
    animate(bottomRadius, target.bottomRadius, transition);
    animate(opacity, target.opacity, { duration: reduced ? 0 : 0.2 });
    animate(offsetY, marginTop, reduced ? { duration: 0 } : SPRING.position);
  }, [
    state,
    hovered,
    reduced,
    target.width,
    target.height,
    target.topRadius,
    target.bottomRadius,
    target.opacity,
    marginTop,
    width,
    height,
    topRadius,
    bottomRadius,
    opacity,
    offsetY,
  ]);

  const clickable = state === 'idle' || state === 'compact' || state === 'alert';

  const activate = () => {
    if (state === 'idle') send({ type: 'ACTIVATE' });
    else if (state === 'compact') send({ type: 'EXPAND' });
    else if (state === 'alert') send({ type: 'ALERT_END' });
  };

  const handleClick = () => {
    if (drag.consumeClick()) return; // el clic que cierra un arrastre no expande la isla
    activate();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };

  const attached = style === 'attached';
  const alignment =
    anchor === 'left' ? 'justify-start' : anchor === 'right' ? 'justify-end' : 'justify-center';
  const edge = anchor === 'left' || anchor === 'right' ? SHAPE.edgeMargin : 0;

  return (
    <div className={cn('fixed inset-x-0 top-0 flex', alignment)} style={{ paddingInline: edge }}>
      <motion.div className="relative" style={{ y: offsetY }}>
        <motion.div
          data-island=""
          data-hit-target={state === 'hidden' ? undefined : ''}
          data-clickable={clickable ? '' : undefined}
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          aria-label={clickable && ARIA_LABEL[state] ? t(ARIA_LABEL[state]) : undefined}
          aria-hidden={state === 'hidden' ? true : undefined}
          onClick={clickable ? handleClick : undefined}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          onPointerCancel={drag.onPointerCancel}
          onKeyDown={clickable ? handleKeyDown : undefined}
          className="relative bg-island outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          style={{
            width,
            height,
            opacity,
            borderTopLeftRadius: topRadius,
            borderTopRightRadius: topRadius,
            borderBottomLeftRadius: bottomRadius,
            borderBottomRightRadius: bottomRadius,
            // Borde interior sutil; pegada al borde superior no se dibuja el de arriba.
            boxShadow: attached
              ? 'inset 1px 0 0 var(--island-border), inset -1px 0 0 var(--island-border), inset 0 -1px 0 var(--island-border)'
              : 'inset 0 0 0 1px var(--island-border), 0 6px 16px rgba(0, 0, 0, 0.28)',
          }}
        >
          <NotchShape visible={attached && state !== 'hidden'} />

          {/* Recorta el contenido con la misma forma que el contenedor. */}
          <motion.div
            className="absolute inset-0 overflow-hidden"
            style={{
              borderTopLeftRadius: topRadius,
              borderTopRightRadius: topRadius,
              borderBottomLeftRadius: bottomRadius,
              borderBottomRightRadius: bottomRadius,
            }}
          >
            <IslandContent
              state={state}
              style={style}
              notch={notch}
              topInset={target.topInset}
              onMeasure={setContentHeight}
            />
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
