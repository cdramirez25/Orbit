import type { InputHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

/** Campo de texto. El cursor deshabilitado lo da la regla global de `base.css`. */
export function Input({ type = 'text', className, ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        'h-7 w-full rounded-lg bg-white/8 px-2.5 text-[12px] text-ink transition-colors duration-150',
        'outline-none placeholder:text-ink-faint hover:bg-white/12',
        'focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
