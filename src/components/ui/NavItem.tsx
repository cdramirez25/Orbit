import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/utils/cn';

export interface NavItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** ¿Es la página en la que está el usuario? */
  current: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** Entrada de una barra de navegación lateral: icono y texto (los pone quien lo usa). */
export function NavItem({ current, type = 'button', className, ...props }: NavItemProps) {
  return (
    <button
      type={type}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] font-medium',
        'transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-white/60',
        current ? 'bg-white/12 text-ink' : 'text-ink-dim hover:bg-white/8 hover:text-ink',
        className,
      )}
      {...props}
    />
  );
}
