import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/utils/cn';

export interface ToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'role'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  ref?: Ref<HTMLButtonElement>;
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  type = 'button',
  className,
  ...props
}: ToggleProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-white/20 hover:bg-white/28',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white transition-transform duration-150',
          checked && 'translate-x-3.5',
        )}
      />
    </button>
  );
}
