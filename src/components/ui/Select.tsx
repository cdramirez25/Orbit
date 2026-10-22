import type { Ref, SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>;
}

/** Lista desplegable. El cursor (pointer / not-allowed) lo da la regla global de `base.css`. */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        'h-7 w-full rounded-lg bg-white/8 px-2 text-[12px] text-ink transition-colors duration-150',
        'outline-none hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-white/60',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
