import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';

import { IconButton } from '@/components/ui';
import { useElementHeight } from '@/hooks/useElementHeight';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { CONTENT, REDUCED_MOTION, resolveIslandTarget, SIZE } from '@/lib/island/island.motion';
import { selectActiveModule, useRegistryStore } from '@/modules/registry';
import { useIslandStore } from '@/stores/island.store';
import type { IslandAlert, IslandState, IslandStyle, NotchInfo, OrbitModule } from '@/types';

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
      className="absolute inset-0 flex justify-center"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

function ExpandedView({
  module,
  topInset,
  onMeasure,
  onCollapse,
}: {
  module: OrbitModule;
  topInset: number;
  onMeasure: (height: number) => void;
  onCollapse: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useElementHeight(boxRef, onMeasure);

  // Texto en streaming: cuando pasa del tope de altura, el scroll interno sigue al final.
  useEffect(() => {
    const scroller = scrollRef.current;
    const inner = scroller?.firstElementChild;
    if (!scroller || !inner) return;
    const observer = new ResizeObserver(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={boxRef}
      className="relative flex shrink-0 flex-col"
      style={{
        width: SIZE.expanded.width,
        maxHeight: SIZE.expanded.maxHeight,
        paddingTop: topInset,
      }}
    >
      <IconButton label="Contraer" className="absolute top-2 right-3 z-10" onClick={onCollapse}>
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
        className="min-h-0 flex-1 [scrollbar-width:none] overflow-y-auto px-5 pt-3 pb-4 [&::-webkit-scrollbar]:hidden"
      >
        <div>
          <module.Expanded />
        </div>
      </div>
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
            onMeasure={onMeasure}
            onCollapse={() => send({ type: 'COLLAPSE' })}
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
