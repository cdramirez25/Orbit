import {
  ArrowUpDown,
  CloudOff,
  Droplets,
  MapPin,
  RefreshCw,
  Thermometer,
  Umbrella,
  Wind,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { Button, IconButton } from '@/components/ui';
import { useLocaleStore } from '@/i18n/locale.store';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils/cn';
import { formatClock } from '@/lib/utils/time';
import {
  CONDITION_KEYS,
  formatTemperature,
  speedUnit,
  weatherKind,
} from '@/lib/weather/weather-kind';
import { WeatherIcon } from '@/modules/weather/WeatherIcon';
import { useWeatherStore } from '@/stores/weather.store';

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-white/6 px-2 py-1.5">
      <p className="flex items-center gap-1 text-[10px] text-ink-faint">
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-0.5 truncate text-[13px] font-semibold text-ink tabular-nums">{value}</p>
    </div>
  );
}

/** Clima de la zona del usuario: temperatura, condición y detalles de hoy. */
export function Expanded() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const report = useWeatherStore((s) => s.report);
  const status = useWeatherStore((s) => s.status);
  const errorCode = useWeatherStore((s) => s.errorCode);
  const refresh = useWeatherStore((s) => s.refresh);

  if (!report) {
    if (status === 'error') {
      return (
        <div className="flex items-center gap-3 py-2 pr-2">
          <CloudOff aria-hidden className="size-6 shrink-0 text-ink-dim" />
          <p className="min-w-0 flex-1 text-[13px] text-ink-dim">
            {t(errorCode === 'weather.network' ? 'weather.error.network' : 'weather.error.generic')}
          </p>
          <Button size="sm" onClick={() => void refresh(true)}>
            {t('weather.retry')}
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
        <p className="text-[13px] text-ink-dim">{t('weather.loading')}</p>
      </div>
    );
  }

  const { current, today, location, units } = report;
  const place = [location.name, location.country].filter(Boolean).join(', ');

  return (
    <div>
      <div className="flex items-center gap-4">
        <WeatherIcon
          code={current.weatherCode}
          isDay={current.isDay}
          className="size-12 shrink-0"
        />
        <p className="text-[40px] leading-none font-semibold text-ink tabular-nums">
          {formatTemperature(current.temperature)}
        </p>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink">
            {t(CONDITION_KEYS[weatherKind(current.weatherCode)])}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-dim">
            <MapPin aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{place}</span>
          </p>
        </div>
        <IconButton
          label={t('weather.refresh')}
          disabled={status === 'loading'}
          onClick={() => void refresh(true)}
        >
          <RefreshCw
            aria-hidden
            className={cn(
              'size-3.5',
              status === 'loading' && 'animate-spin motion-reduce:animate-none',
            )}
          />
        </IconButton>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-2">
        <Stat
          icon={Thermometer}
          value={formatTemperature(current.apparentTemperature)}
          label={t('weather.feelsLike')}
        />
        <Stat
          icon={Droplets}
          value={`${Math.round(current.humidity)}%`}
          label={t('weather.humidity')}
        />
        <Stat
          icon={Wind}
          value={`${Math.round(current.windSpeed)} ${speedUnit(units)}`}
          label={t('weather.wind')}
        />
        <Stat
          icon={ArrowUpDown}
          value={`${formatTemperature(today.temperatureMax)} / ${formatTemperature(today.temperatureMin)}`}
          label={t('weather.highLow')}
        />
        {today.precipitationProbability !== null && (
          <Stat
            icon={Umbrella}
            value={`${Math.round(today.precipitationProbability)}%`}
            label={t('weather.rainChance')}
          />
        )}
      </div>

      <p className="mt-2 text-[11px] text-ink-faint">
        {t('weather.updatedAt')} {formatClock(report.fetchedAtMs, locale)}
      </p>
    </div>
  );
}
