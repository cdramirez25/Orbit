import { cn } from '@/lib/utils/cn';

export interface ProgressBarProps {
  /** Avance de 0 a 100. */
  value: number;
  /** Qué avanza (para lectores de pantalla). */
  label: string;
  className?: string;
}

/** Barra de progreso: no se pulsa, solo muestra cuánto va. */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/10', className)}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-200"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
