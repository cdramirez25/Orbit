import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import { cn } from '@/lib/utils/cn';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Obligatorio: un botón de solo icono necesita nombre accesible. */
  label: string;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  type = 'button',
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-full text-ink-dim',
        'transition-colors duration-150 outline-none hover:bg-white/12 hover:text-ink active:bg-white/20',
        'focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
