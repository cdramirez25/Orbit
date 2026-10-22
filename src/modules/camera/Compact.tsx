import { Camera } from 'lucide-react';

import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils/cn';
import { useCameraStore } from '@/stores/camera.store';

/** Pastilla: la cámara a la izquierda y, si está encendida, un punto a la derecha. */
export function Compact() {
  const t = useT();
  const on = useCameraStore((s) => s.status === 'on');

  return (
    <div className="flex h-full items-center justify-between px-5">
      <Camera aria-hidden className={cn('size-4', on ? 'text-accent' : 'text-ink-faint')} />
      <span className="sr-only">{t(on ? 'camera.status.on' : 'camera.status.off')}</span>
      {on && <span aria-hidden className="size-2 rounded-full bg-accent" />}
    </div>
  );
}
