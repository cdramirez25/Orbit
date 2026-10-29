import { Cpu, MemoryStick } from 'lucide-react';

import { useSystemPolling } from '@/hooks/useSystemPolling';
import { useT } from '@/i18n/useT';
import { batteryAlert, memoryPercent } from '@/lib/system';
import { cn } from '@/lib/utils/cn';
import { BATTERY_ICONS, batteryIconName } from '@/modules/system/battery-icon';
import { useSystemStore } from '@/stores/system.store';

/**
 * Pastilla: a la izquierda la batería (o la memoria en un equipo de escritorio) y a la derecha la CPU,
 * cada una con su porcentaje (el centro es del notch).
 */
export function Compact() {
  const t = useT();
  useSystemPolling();
  const stats = useSystemStore((s) => s.stats);

  const battery = stats?.battery ?? null;
  const LeftIcon = battery ? BATTERY_ICONS[batteryIconName(battery)] : MemoryStick;
  const left = stats ? Math.round(battery ? battery.percent : memoryPercent(stats.memory)) : null;
  const alert = battery ? batteryAlert(battery) : null;

  return (
    <div className="flex h-full items-center justify-between px-5">
      <span className="flex items-center gap-1.5">
        <LeftIcon
          aria-hidden
          className={cn(
            'size-4',
            alert === 'critical'
              ? 'text-danger'
              : alert === 'low'
                ? 'text-warning'
                : 'text-ink-dim',
          )}
        />
        <span className="text-[13px] font-semibold text-ink tabular-nums">
          {left === null ? '--' : `${left}%`}
        </span>
        <span className="sr-only">{t(battery ? 'system.battery' : 'system.memory')}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <Cpu aria-hidden className="size-4 text-ink-dim" />
        <span className="text-[13px] font-semibold text-ink tabular-nums">
          {stats ? `${Math.round(stats.cpu.percent)}%` : '--'}
        </span>
        <span className="sr-only">{t('system.cpu')}</span>
      </span>
    </div>
  );
}
