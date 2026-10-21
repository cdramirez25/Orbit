import { ClipboardList } from 'lucide-react';

import { useClipboardStore } from '@/stores/clipboard.store';

/** Pastilla: icono del portapapeles a la izquierda y cuántos elementos hay guardados a la derecha. */
export function Compact() {
  const count = useClipboardStore((s) => s.entries.length);

  return (
    <div className="flex h-full items-center justify-between px-5">
      <ClipboardList aria-hidden className="size-4 text-accent" />
      <span className="text-[13px] font-semibold text-ink tabular-nums">{count}</span>
    </div>
  );
}
