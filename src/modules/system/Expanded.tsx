import {
  ArrowDown,
  ArrowUp,
  BatteryWarning,
  CircleAlert,
  Cpu,
  MemoryStick,
  RefreshCw,
  TriangleAlert,
  Wifi,
} from 'lucide-react';
import { useState } from 'react';

import { Button, ProgressBar } from '@/components/ui';
import { useSystemPolling } from '@/hooks/useSystemPolling';
import { useLocaleStore } from '@/i18n/locale.store';
import { useT } from '@/i18n/useT';
import {
  batteryAlert,
  batteryTone,
  formatAgo,
  formatBytes,
  formatMinutes,
  formatRate,
  levelTone,
  loadLevel,
  memoryPercent,
  niceCeiling,
} from '@/lib/system';
import { BATTERY_ICONS, batteryIconName } from '@/modules/system/battery-icon';
import { Sparkline } from '@/modules/system/Sparkline';
import { Figure, StatusNote, Tile } from '@/modules/system/Tile';
import { useSystemStore } from '@/stores/system.store';
import type { Battery, SystemStats } from '@/types';

/** Lo más bajo que llega la escala de la red: por debajo, un hilo de tráfico se ve plano. */
const NETWORK_SCALE_FLOOR = 64 * 1024;

const peak = (values: readonly number[]) => values.reduce((a, b) => Math.max(a, b), 0);

/** Cuántos segundos hace de la lectura `index` (se lee una por segundo). */
const secondsAgo = (index: number, length: number) => length - 1 - index;

function BatteryTile({ battery }: { battery: Battery }) {
  const t = useT();
  const alert = batteryAlert(battery);
  const Icon = BATTERY_ICONS[batteryIconName(battery)];
  const time =
    battery.minutesLeft === null
      ? null
      : formatMinutes(battery.minutesLeft, {
          hour: t('system.unit.hour'),
          minute: t('system.unit.minute'),
        });
  const timeNote =
    time && (battery.state === 'discharging' || battery.state === 'charging')
      ? t(battery.state === 'discharging' ? 'system.battery.left' : 'system.battery.toFull')
      : null;

  return (
    <Tile
      icon={Icon}
      label={t('system.battery')}
      note={
        alert && (
          <StatusNote icon={BatteryWarning} tone={alert === 'critical' ? 'danger' : 'warning'}>
            {t(alert === 'critical' ? 'system.battery.critical' : 'system.battery.low')}
          </StatusNote>
        )
      }
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <Figure value={String(Math.round(battery.percent))} unit="%" />
          <p className="mt-1.5 truncate text-[11px] text-ink-dim">
            {t(`system.battery.${battery.state}`)}
          </p>
        </div>
        {time && timeNote && (
          <p className="shrink-0 text-right leading-tight">
            <span className="block text-[13px] font-semibold text-ink tabular-nums">{time}</span>
            <span className="block text-[10px] text-ink-faint">{timeNote}</span>
          </p>
        )}
      </div>
      <ProgressBar
        value={battery.percent}
        label={t('system.battery')}
        tone={batteryTone(battery)}
      />
    </Tile>
  );
}

function CpuTile({ stats, history }: { stats: SystemStats; history: readonly number[] }) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const [hover, setHover] = useState<number | null>(null);
  const marked = hover !== null && hover < history.length ? hover : null;
  const percent = marked === null ? stats.cpu.percent : (history[marked] ?? stats.cpu.percent);
  const level = loadLevel(stats.cpu.percent);
  const now = Math.round(stats.cpu.percent);

  return (
    <Tile
      icon={Cpu}
      label={t('system.cpu')}
      note={
        marked !== null ? (
          <span className="text-[10px] text-ink-faint">
            {formatAgo(secondsAgo(marked, history.length), locale)}
          </span>
        ) : (
          level !== 'normal' && (
            <StatusNote icon={TriangleAlert} tone={levelTone(level)}>
              {t(level === 'critical' ? 'system.level.critical' : 'system.level.high')}
            </StatusNote>
          )
        )
      }
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <Figure value={String(Math.round(percent))} unit="%" />
          <p className="mt-1.5 truncate text-[11px] text-ink-dim">
            {stats.cpu.cores} {t('system.cpu.cores')}
          </p>
        </div>
        <Sparkline
          series={[{ values: history, tone: 'accent', area: true }]}
          max={100}
          width={104}
          height={40}
          label={`${t('system.cpu')}: ${now}%, ${t('system.chart.peak')} ${Math.round(peak(history))}%`}
          hoverIndex={marked}
          onHover={setHover}
        />
      </div>
    </Tile>
  );
}

function MemoryTile({ stats }: { stats: SystemStats }) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const percent = memoryPercent(stats.memory);
  const level = loadLevel(percent);

  return (
    <Tile
      icon={MemoryStick}
      label={t('system.memory')}
      note={
        level !== 'normal' && (
          <StatusNote icon={TriangleAlert} tone={levelTone(level)}>
            {t(level === 'critical' ? 'system.level.critical' : 'system.level.high')}
          </StatusNote>
        )
      }
    >
      <div className="min-w-0">
        <Figure value={String(Math.round(percent))} unit="%" />
        <p className="mt-1.5 truncate text-[11px] text-ink-dim">
          {formatBytes(stats.memory.used, locale)} {t('system.memory.of')}{' '}
          {formatBytes(stats.memory.total, locale)}
        </p>
      </div>
      <ProgressBar value={percent} label={t('system.memory')} tone={levelTone(level)} />
    </Tile>
  );
}

function Speed({
  icon: Icon,
  tone,
  label,
  bytesPerSec,
}: {
  icon: typeof ArrowDown;
  tone: string;
  label: string;
  bytesPerSec: number;
}) {
  const locale = useLocaleStore((s) => s.locale);
  const { value, unit } = formatRate(bytesPerSec, locale);
  return (
    <p className="flex items-center gap-1.5 leading-none">
      <Icon aria-hidden className={`size-3.5 shrink-0 ${tone}`} />
      <span className="sr-only">{label}</span>
      <span className="text-[16px] font-semibold text-ink tabular-nums">{value}</span>
      <span className="text-[11px] font-medium text-ink-dim">{unit}</span>
    </p>
  );
}

function NetworkTile({
  stats,
  down,
  up,
  wide,
}: {
  stats: SystemStats;
  down: readonly number[];
  up: readonly number[];
  wide: boolean;
}) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const [hover, setHover] = useState<number | null>(null);
  const marked = hover !== null && hover < down.length ? hover : null;
  const downNow = marked === null ? stats.network.downPerSec : (down[marked] ?? 0);
  const upNow = marked === null ? stats.network.upPerSec : (up[marked] ?? 0);
  const scale = niceCeiling(Math.max(peak(down), peak(up)), NETWORK_SCALE_FLOOR);
  const rate = (bytes: number) => {
    const { value, unit } = formatRate(bytes, locale);
    return `${value} ${unit}`;
  };

  return (
    <Tile
      icon={Wifi}
      label={t('system.network')}
      className={wide ? 'col-span-2' : undefined}
      note={
        marked !== null && (
          <span className="text-[10px] text-ink-faint">
            {formatAgo(secondsAgo(marked, down.length), locale)}
          </span>
        )
      }
    >
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2.5">
          <Speed
            icon={ArrowDown}
            tone="text-accent"
            label={t('system.network.down')}
            bytesPerSec={downNow}
          />
          <Speed
            icon={ArrowUp}
            tone="text-ink-dim"
            label={t('system.network.up')}
            bytesPerSec={upNow}
          />
        </div>
        <Sparkline
          series={[
            { values: down, tone: 'accent', area: true },
            { values: up, tone: 'muted' },
          ]}
          max={scale}
          width={wide ? 280 : 104}
          height={40}
          label={`${t('system.network')}: ${t('system.network.down')} ${rate(stats.network.downPerSec)}, ${t('system.network.up')} ${rate(stats.network.upPerSec)}`}
          hoverIndex={marked}
          onHover={setHover}
        />
      </div>
    </Tile>
  );
}

/** El equipo: batería (solo si tiene), CPU, memoria y red, con su gráfica del último minuto. */
export function Expanded() {
  const t = useT();
  useSystemPolling();
  const stats = useSystemStore((s) => s.stats);
  const history = useSystemStore((s) => s.history);
  const status = useSystemStore((s) => s.status);
  const refresh = useSystemStore((s) => s.refresh);

  if (!stats) {
    if (status === 'error') {
      return (
        <div className="flex items-center gap-3 py-2 pr-2">
          <CircleAlert aria-hidden className="size-6 shrink-0 text-ink-dim" />
          <p className="min-w-0 flex-1 text-[13px] text-ink-dim">{t('system.error')}</p>
          <Button size="sm" onClick={() => void refresh()}>
            {t('system.retry')}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3 py-2">
        <RefreshCw
          aria-hidden
          className="size-4 animate-spin text-ink-dim motion-reduce:animate-none"
        />
        <p className="text-[13px] text-ink-dim">{t('system.loading')}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {stats.battery && <BatteryTile battery={stats.battery} />}
      <CpuTile stats={stats} history={history.cpu} />
      <MemoryTile stats={stats} />
      <NetworkTile stats={stats} down={history.down} up={history.up} wide={!stats.battery} />
    </div>
  );
}
