import type { Ref, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

/** Campo de texto de varias líneas. El cursor deshabilitado lo da la regla global de `base.css`. */
export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'w-full resize-none rounded-lg bg-white/8 px-2.5 py-1.5 text-[12px] leading-snug text-ink',
        'transition-colors duration-150 outline-none placeholder:text-ink-faint hover:bg-white/12',
        'focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
