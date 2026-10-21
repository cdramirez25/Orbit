import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, IconButton } from '@/components/ui';
import { useElementHeight } from '@/hooks/useElementHeight';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useT } from '@/i18n/useT';
import {
  CONTENT,
  expandedMaxHeight,
  REDUCED_MOTION,
  resolveIslandTarget,
  SIZE,
} from '@/lib/island/island.motion';
import { selectActiveModule, useRegistryStore } from '@/modules/registry';
import { useIslandStore } from '@/stores/island.store';
import type {
  ExpandedSize,
  IslandAlert,
  IslandState,
  IslandStyle,
  NotchInfo,
  OrbitModule,
} from '@/types';

interface IslandContentProps {
  state: IslandState;
  style: IslandStyle;
  notch: NotchInfo | null;
  /** Franja que ocupa el notch arriba (solo `attached`). */
  topInset: number;
  /** Recibe el alto natural del contenido expandido. */
  onMeasure: (height: number) => void;
}

function useLayerVariants(): Variants {
  const reduced = useReducedMotion();

  if (reduced) {
    const fade = { duration: REDUCED_MOTION.fadeDuration };
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: fade },
      exit: { opacity: 0, transition: fade },
    };
  }

  return {
    // Al expandir: fade + blur 6px→0 + escala 0.96→1, con retraso para que el contenedor
    // crezca primero. Al contraer: se desvanece rápido antes de que el contenedor se mueva.
    hidden: { opacity: 0, scale: CONTENT.scaleFrom, filter: `blur(${CONTENT.blurPx}px)` },
    visible: {
      opacity: 1,
      scale: 1,
      filter: 'blur(0px)',
      transition: {
        delay: CONTENT.enterDelay,
        duration: CONTENT.enterDuration,
        ease: [...CONTENT.ease],
      },
    },
    exit: { opacity: 0, transition: { duration: CONTENT.exitDuration } },
  };
}

function Layer({ variants, children }: { variants: Variants; children: ReactNode }) {
  return (
    <motion.div
      // `items-start`: el contenido toma su alto natural. Con `stretch` (por defecto) se estiraba
      // al alto actual de la isla y lo medido nunca crecía: la tarjeta se quedaba pequeña.
      className="absolute inset-0 flex items-start justify-center"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path
        d={up ? 'M2 6.5l3-3 3 3' : 'M2 3.5l3 3 3-3'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExpandedView({
  module,
  topInset,
  size,
  onMeasure,
  onCollapse,
  onToggleSize,
}: {
  module: OrbitModule;
  topInset: number;
  size: ExpandedSize;
  onMeasure: (height: number) => void;
  onCollapse: () => void;
  onToggleSize: () => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // ¿El contenido no cabe y hay que deslizar? Entonces se ofrece "Alargar".
  const [overflowing, setOverflowing] = useState(false);

  useElementHeight(boxRef, onMeasure);

  // Texto en streaming: el scroll interno sigue al final, y se detecta si el texto desborda
  // (al crecer el texto o al cambiar el tamaño de la tarjeta).
  useEffect(() => {
    const scroller = scrollRef.current;
    const inner = scroller?.firstElementChild;
    if (!scroller || !inner) return;
    const observer = new ResizeObserver(() => {
      scroller.scrollTop = scroller.scrollHeight;
      setOverflowing(scroller.scrollHeight > scroller.clientHeight + 1);
    });
    observer.observe(inner);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const tall = size === 'tall';

  return (
    <div
      ref={boxRef}
      className="relative flex shrink-0 flex-col"
      style={{
        width: SIZE.expanded.width,
        maxHeight: expandedMaxHeight(size, topInset),
        paddingTop: topInset,
      }}
    >
      <IconButton
        label={t('island.collapse')}
        className="absolute top-2 right-3 z-10"
        onClick={onCollapse}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path
            d="M1 1l8 8M9 1L1 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </IconButton>
      <div
        ref={scrollRef}
        className="min-h-0 flex-initial [scrollbar-width:none] overflow-y-auto px-5 pt-3 pb-4 [&::-webkit-scrollbar]:hidden"
      >
        <div>
          <module.Expanded />
        </div>
      </div>

      {/* Abajo, dentro de la isla: estira la tarjeta (4 → 8 filas) y la devuelve a su tamaño. */}
      {(overflowing || tall) && (
        <div className="flex h-8 shrink-0 items-center justify-center">
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggleSize}
            aria-label={t(tall ? 'island.shrinkAria' : 'island.stretchAria')}
            aria-expanded={tall}
          >
            <Chevron up={tall} />
            {t(tall ? 'island.shrink' : 'island.stretch')}
          </Button>
        </div>
      )}
    </div>
  );
}

function AlertView({
  alert,
  width,
  topInset,
}: {
  alert: IslandAlert;
  width: number;
  topInset: number;
}) {
  return (
    <div
      className="flex h-full shrink-0 items-center gap-3 px-5"
      style={{ width, paddingTop: topInset }}
    >
      <span className="orbit-pulse size-2.5 shrink-0 rounded-full bg-accent" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-ink">{alert.title}</p>
        {alert.message && <p className="truncate text-[12px] text-ink-dim">{alert.message}</p>}
      </div>
    </div>
  );
}

/** Muestra la vista del módulo activo que corresponde al estado (compact / expanded / alert). */
export function IslandContent({ state, style, notch, topInset, onMeasure }: IslandContentProps) {
  const activeModule = useRegistryStore(selectActiveModule);
  const alert = useIslandStore((s) => s.alert);
  const send = useIslandStore((s) => s.send);
  const expandedSize = useIslandStore((s) => s.expandedSize);
  const toggleExpandedSize = useIslandStore((s) => s.toggleExpandedSize);
  const variants = useLayerVariants();

  const dims = { style, notch, hovered: false, contentHeight: 0 } as const;
  const compactWidth = resolveIslandTarget({ ...dims, state: 'compact' }).width;
  const alertWidth = resolveIslandTarget({ ...dims, state: 'alert' }).width;

  return (
    <AnimatePresence initial={false}>
      {state === 'compact' && activeModule && (
        <Layer key="compact" variants={variants}>
          <div className="h-full shrink-0" style={{ width: compactWidth }}>
            <activeModule.Compact />
          </div>
        </Layer>
      )}

      {state === 'expanded' && activeModule && (
        <Layer key="expanded" variants={variants}>
          <ExpandedView
            module={activeModule}
            topInset={topInset}
            size={expandedSize}
            onMeasure={onMeasure}
            onCollapse={() => send({ type: 'COLLAPSE' })}
            onToggleSize={toggleExpandedSize}
          />
        </Layer>
      )}

      {state === 'alert' && alert && (
        <Layer key="alert" variants={variants}>
          <AlertView alert={alert} width={alertWidth} topInset={topInset} />
        </Layer>
      )}
    </AnimatePresence>
  );
}
