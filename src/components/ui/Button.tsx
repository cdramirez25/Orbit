import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-white text-black hover:bg-white/85 active:bg-white/70',
  secondary: 'bg-white/10 text-ink hover:bg-white/16 active:bg-white/22',
  ghost: 'bg-transparent text-ink-dim hover:bg-white/10 hover:text-ink active:bg-white/16',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 active:bg-danger/35',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2.5 text-[11px]',
  md: 'h-8 px-3.5 text-[13px]',
};

/** El cursor (pointer / not-allowed) lo da la regla global de `base.css`; aquí no se repite. */
export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap',
        'transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-white/60',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
