import { CalendarClock, Coffee, Infinity as InfinityIcon } from 'lucide-react';

import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n/useT';
import { remainingMs } from '@/lib/awake';
import { formatDuration } from '@/lib/utils/time';
import { cn } from '@/lib/utils/cn';
import { useAwakeStore } from '@/stores/awake.store';

/** Lo que falta, contando cada segundo (solo existe mientras hay un tiempo en marcha). */
function Countdown({ endsAt }: { endsAt: number }) {
  const now = useNow(1000);
  const left = remainingMs({ mode: 'until', endsAt }, now) ?? 0;
  return (
    <span className="text-[13px] font-semibold text-ink tabular-nums">
      {formatDuration(left / 1000)}
    </span>
  );
}

/**
 * Pastilla: la taza a la izquierda (encendida si se está manteniendo la pantalla) y a la derecha lo
 * que falta, el infinito o el calendario según el modo.
 */
export function Compact() {
  const t = useT();
  const status = useAwakeStore((s) => s.status);
  const active = status?.active ?? false;
  const setting = status?.setting;
  const statusKey = active
    ? 'awake.status.on'
    : setting?.mode === 'schedule'
      ? 'awake.status.scheduled'
      : 'awake.status.off';

  return (
    <div className="flex h-full items-center justify-between px-5">
      <Coffee aria-hidden className={cn('size-4', active ? 'text-accent' : 'text-ink-faint')} />
      <span className="sr-only">{t(statusKey)}</span>
      {setting?.mode === 'until' && <Countdown endsAt={setting.endsAt} />}
      {setting?.mode === 'always' && (
        <InfinityIcon
          aria-hidden
          className={cn('size-4', active ? 'text-ink' : 'text-ink-faint')}
        />
      )}
      {setting?.mode === 'schedule' && (
        <CalendarClock
          aria-hidden
          className={cn('size-4', active ? 'text-ink' : 'text-ink-faint')}
        />
      )}
    </div>
  );
}
