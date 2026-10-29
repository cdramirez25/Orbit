import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/** Una tarjeta del módulo: icono y nombre arriba (y, a la derecha, un aviso), y su contenido. */
export function Tile({
  icon: Icon,
  label,
  note,
  className,
  children,
}: {
  icon: LucideIcon;
  label: string;
  /** Lo que va arriba a la derecha: un aviso de estado o, al pasar el puntero, cuándo fue. */
  note?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn('flex min-w-0 flex-col rounded-2xl bg-tile px-3 py-2', className)}
    >
      <div className="flex h-4 items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-ink-dim">
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </h3>
        {note}
      </div>
      <div className="mt-1 flex flex-1 flex-col justify-between gap-1.5">{children}</div>
    </section>
  );
}

const TONE_TEXT = {
  accent: 'text-accent',
  good: 'text-good',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

/** Aviso de estado: siempre un icono y un texto, nunca solo un color. */
export function StatusNote({
  icon: Icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE_TEXT;
  children: ReactNode;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-ink-dim">
      <Icon aria-hidden className={cn('size-3', TONE_TEXT[tone])} />
      {children}
    </span>
  );
}

/** La cifra grande de una tarjeta, con su unidad pequeña al lado. */
export function Figure({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="flex items-baseline gap-1 leading-none">
      <span className="text-[26px] font-semibold text-ink tabular-nums">{value}</span>
      {unit && <span className="text-[12px] font-medium text-ink-dim">{unit}</span>}
    </p>
  );
}
