import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/utils/cn';

export interface TabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role'> {
  selected: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Tab({ selected, type = 'button', className, ...props }: TabProps) {
  return (
    <button
      type={type}
      role="tab"
      aria-selected={selected}
      className={cn(
        'h-6 rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap transition-colors duration-150',
        'outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40',
        selected
          ? 'bg-white text-black'
          : 'bg-white/8 text-ink-dim hover:bg-white/16 hover:text-ink active:bg-white/24',
        className,
      )}
      {...props}
    />
  );
}
