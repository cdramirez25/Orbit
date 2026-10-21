import { ChevronDown, ChevronUp, Settings, X } from 'lucide-react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ModuleSwitcher } from '@/components/island/ModuleSwitcher';
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
import { cn } from '@/lib/utils/cn';
import { selectActiveModule, useRegistryStore } from '@/modules/registry';
import { useIslandStore } from '@/stores/island.store';
import { SETTINGS_WINDOW_AVAILABLE, useSettingsWindowStore } from '@/stores/settingsWindow.store';
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

function ExpandedView({
  module,
  switchable,
  topInset,
  size,
  onMeasure,
  onCollapse,
  onToggleSize,
}: {
  module: OrbitModule;
  /** Módulos residentes entre los que el usuario puede cambiar (vacío si no aplica). */
  switchable: readonly OrbitModule[];
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
  const select = useRegistryStore((s) => s.select);
  const followEnd = module.followEnd === true;
  const openSettings = useSettingsWindowStore((s) => s.open);

  useElementHeight(boxRef, onMeasure);

  // Se detecta si el contenido desborda (al crecer o al cambiar el tamaño de la tarjeta) y, si el
  // módulo crece por abajo (texto en streaming), el scroll interno sigue al final.
  useEffect(() => {
    const scroller = scrollRef.current;
    const inner = scroller?.firstElementChild;
    if (!scroller || !inner) return;
    const observer = new ResizeObserver(() => {
      if (followEnd) scroller.scrollTop = scroller.scrollHeight;
      setOverflowing(scroller.scrollHeight > scroller.clientHeight + 1);
    });
    observer.observe(inner);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [followEnd]);

  const tall = size === 'tall';

  const actions = (
    <div className="flex items-center gap-0.5">
      {SETTINGS_WINDOW_AVAILABLE && (
        <IconButton label={t('island.settingsShow')} onClick={openSettings}>
          <Settings aria-hidden className="size-3.5" />
        </IconButton>
      )}
      <IconButton label={t('island.collapse')} onClick={onCollapse}>
        <X aria-hidden className="size-3.5" />
      </IconButton>
    </div>
  );

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
      {switchable.length > 0 ? (
        <div className="flex h-9 shrink-0 items-center justify-between pr-3 pl-4">
          <ModuleSwitcher
            modules={switchable}
            activeId={module.id}
            onSelect={(id) => {
              select(id);
              // Cada módulo empieza con la tarjeta de tamaño normal.
              if (size === 'tall') onToggleSize();
            }}
          />
          {actions}
        </div>
      ) : (
        <div className="absolute top-2 right-3 z-10">{actions}</div>
      )}
      <div
        ref={scrollRef}
        className={cn(
          'min-h-0 flex-initial [scrollbar-width:none] overflow-y-auto px-5 pb-4 [&::-webkit-scrollbar]:hidden',
          switchable.length > 0 ? 'pt-1' : 'pt-3',
        )}
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
            {tall ? (
              <ChevronUp aria-hidden className="size-3" />
            ) : (
              <ChevronDown aria-hidden className="size-3" />
            )}
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
  const modules = useRegistryStore((s) => s.modules);
  const alert = useIslandStore((s) => s.alert);
  const send = useIslandStore((s) => s.send);
  const expandedSize = useIslandStore((s) => s.expandedSize);
  const toggleExpandedSize = useIslandStore((s) => s.toggleExpandedSize);
  const variants = useLayerVariants();

  // El selector solo aparece si el módulo visible es residente y hay otro entre quien elegir.
  const ambient = Object.values(modules).filter((module) => module.ambient);
  const switchable = activeModule?.ambient && ambient.length > 1 ? ambient : [];

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
            switchable={switchable}
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
