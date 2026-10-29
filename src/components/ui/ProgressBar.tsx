import { cn } from '@/lib/utils/cn';

/** Color del relleno. La parte sin llenar toma el mismo color, más claro. */
export type ProgressTone = 'accent' | 'good' | 'warning' | 'danger';

const FILL: Record<ProgressTone, string> = {
  accent: 'bg-accent',
  good: 'bg-good',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const TRACK: Record<ProgressTone, string> = {
  accent: 'bg-accent/20',
  good: 'bg-good/20',
  warning: 'bg-warning/20',
  danger: 'bg-danger/20',
};

export interface ProgressBarProps {
  /** Avance de 0 a 100. */
  value: number;
  /** Qué avanza (para lectores de pantalla). */
  label: string;
  /** Sin esto, relleno de acento sobre un fondo neutro (descargas, reproducción). */
  tone?: ProgressTone;
  className?: string;
}

/** Barra de progreso: no se pulsa, solo muestra cuánto va. */
export function ProgressBar({ value, label, tone, className }: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn(
        'h-1.5 w-full overflow-hidden rounded-full',
        tone ? TRACK[tone] : 'bg-white/10',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none',
          tone ? FILL[tone] : 'bg-accent',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
