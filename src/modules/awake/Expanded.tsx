import { Coffee, Power, PowerOff } from 'lucide-react';

import { Button, Select, Tab } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useLocaleStore } from '@/i18n/locale.store';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { DURATION_MINUTES, SCHEDULE_MINUTES, formatMinutes, remainingMs } from '@/lib/awake';
import { cn } from '@/lib/utils/cn';
import { formatDuration, formatMinuteOfDay } from '@/lib/utils/time';
import { useAwakeStore, type AwakeTab } from '@/stores/awake.store';

const TABS: ReadonlyArray<{ id: AwakeTab; label: MessageKey }> = [
  { id: 'duration', label: 'awake.tab.duration' },
  { id: 'schedule', label: 'awake.tab.schedule' },
  { id: 'always', label: 'awake.tab.always' },
];

function errorKey(code: string): MessageKey {
  if (code === 'awake.system') return 'awake.error.system';
  if (code === 'awake.invalidSchedule') return 'awake.error.invalidSchedule';
  return 'awake.error.generic';
}

/** Cómo está ahora: el modo activo y lo que falta, el horario o que no hay nada puesto. */
function StateLine() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const now = useNow(1000);
  const setting = useAwakeStore((s) => s.status?.setting);
  const active = useAwakeStore((s) => s.status?.active ?? false);

  if (!setting || setting.mode === 'off') {
    return <p className="text-[13px] text-ink-dim">{t('awake.state.off')}</p>;
  }
  if (setting.mode === 'always') {
    return <p className="text-[13px] text-ink">{t('awake.state.always')}</p>;
  }
  if (setting.mode === 'until') {
    const left = remainingMs(setting, now) ?? 0;
    return (
      <p className="text-[13px] text-ink">
        {t('awake.state.remaining')}{' '}
        <span className="font-semibold tabular-nums">{formatDuration(left / 1000)}</span>
      </p>
    );
  }
  // Fuera de horario, si la hora de inicio todavía no llegó hoy, empieza hoy; si ya pasó, mañana.
  const today = new Date(now);
  const minuteNow = today.getHours() * 60 + today.getMinutes();
  const startsKey: MessageKey =
    minuteNow < setting.start ? 'awake.state.startsToday' : 'awake.state.startsTomorrow';
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[13px] text-ink">
        {t('awake.state.daily')}{' '}
        <span className="font-semibold">
          {formatMinuteOfDay(setting.start, locale)} – {formatMinuteOfDay(setting.end, locale)}
        </span>
      </p>
      <p className={cn('text-[11px]', active ? 'text-accent' : 'text-ink-faint')}>
        {active
          ? t('awake.state.inSchedule')
          : `${t(startsKey)} ${formatMinuteOfDay(setting.start, locale)}`}
      </p>
    </div>
  );
}

function DurationForm() {
  const t = useT();
  const minutes = useAwakeStore((s) => s.durationMinutes);
  const setMinutes = useAwakeStore((s) => s.setDurationMinutes);
  const hour = t('awake.unit.hour');
  const minute = t('awake.unit.minute');

  return (
    <label className="flex flex-col gap-1 text-[11px] text-ink-dim">
      {t('awake.duration.label')}
      <Select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
        {DURATION_MINUTES.map((value) => (
          <option key={value} value={value}>
            {formatMinutes(value, hour, minute)}
          </option>
        ))}
      </Select>
    </label>
  );
}

function ScheduleForm() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const start = useAwakeStore((s) => s.scheduleStart);
  const end = useAwakeStore((s) => s.scheduleEnd);
  const setStart = useAwakeStore((s) => s.setScheduleStart);
  const setEnd = useAwakeStore((s) => s.setScheduleEnd);

  const options = SCHEDULE_MINUTES.map((value) => (
    <option key={value} value={value}>
      {formatMinuteOfDay(value, locale)}
    </option>
  ));

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-[11px] text-ink-dim">
        {t('awake.schedule.from')}
        <Select value={start} onChange={(event) => setStart(Number(event.target.value))}>
          {options}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-ink-dim">
        {t('awake.schedule.to')}
        <Select value={end} onChange={(event) => setEnd(Number(event.target.value))}>
          {options}
        </Select>
      </label>
    </div>
  );
}

/**
 * La tarjeta de pantalla encendida: arriba cómo está ahora y cómo desactivarla; debajo, los tres
 * modos (un tiempo, un horario diario o siempre) para activarla.
 */
export function Expanded() {
  const t = useT();
  const status = useAwakeStore((s) => s.status);
  const errorCode = useAwakeStore((s) => s.errorCode) ?? status?.error ?? null;
  const tab = useAwakeStore((s) => s.tab);
  const setTab = useAwakeStore((s) => s.setTab);
  const start = useAwakeStore((s) => s.start);
  const stop = useAwakeStore((s) => s.stop);

  const on = status !== null && status.setting.mode !== 'off';
  const active = status?.active ?? false;
  // Un horario puesto que todavía no toca no está "desactivado": está esperando su hora.
  const statusKey: MessageKey = active
    ? 'awake.status.on'
    : status?.setting.mode === 'schedule'
      ? 'awake.status.scheduled'
      : 'awake.status.off';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-xl',
              active ? 'bg-accent/20 text-accent' : 'bg-white/8 text-ink-dim',
            )}
          >
            <Coffee aria-hidden className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
              {t('awake.module')}
              <span
                role="status"
                className={cn(
                  'rounded-full bg-white/8 px-2 py-0.5 text-[10px] tracking-normal normal-case',
                  active ? 'text-accent' : 'text-ink-dim',
                )}
              >
                {t(statusKey)}
              </span>
            </span>
            <StateLine />
          </div>
        </div>
        {on && (
          <Button size="sm" variant="danger" onClick={() => void stop()}>
            <PowerOff aria-hidden className="size-3" />
            {t('awake.action.stop')}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-white/6 p-2.5">
        <div role="tablist" aria-label={t('awake.tabs.aria')} className="flex items-center gap-1">
          {TABS.map(({ id, label }) => (
            <Tab key={id} selected={tab === id} onClick={() => setTab(id)}>
              {t(label)}
            </Tab>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            {tab === 'duration' && <DurationForm />}
            {tab === 'schedule' && <ScheduleForm />}
            {tab === 'always' && (
              <p className="text-[12px] leading-snug text-ink-dim">{t('awake.always.hint')}</p>
            )}
          </div>
          <Button size="sm" variant="primary" className="h-7 shrink-0" onClick={() => void start()}>
            <Power aria-hidden className="size-3" />
            {t('awake.action.start')}
          </Button>
        </div>
        {tab === 'schedule' && (
          <p className="text-[11px] text-ink-faint">{t('awake.schedule.hint')}</p>
        )}
      </div>

      {errorCode && (
        <p role="alert" className="text-[11px] text-danger">
          {t(errorKey(errorCode))}
        </p>
      )}
    </div>
  );
}
