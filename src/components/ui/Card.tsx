import type { HTMLAttributes, KeyboardEvent } from 'react';

import { cn } from '@/lib/utils/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Si se pasa, la tarjeta es clicable: `role="button"`, teclado y `data-clickable` (mano). */
  onClick?: () => void;
}

export function Card({ onClick, className, onKeyDown, ...props }: CardProps) {
  const base = 'rounded-2xl bg-white/6 p-3';

  if (!onClick) return <div className={cn(base, className)} onKeyDown={onKeyDown} {...props} />;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-clickable=""
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        base,
        'transition-colors duration-150 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60',
        className,
      )}
      {...props}
    />
  );
}
