import { Cloud } from 'lucide-react';

import { formatTemperature } from '@/lib/weather/weather-kind';
import { WeatherIcon } from '@/modules/weather/WeatherIcon';
import { useWeatherStore } from '@/stores/weather.store';

/** Pastilla: icono del clima a la izquierda y temperatura a la derecha (el centro es del notch). */
export function Compact() {
  const report = useWeatherStore((s) => s.report);

  return (
    <div className="flex h-full items-center justify-between px-5">
      {report ? (
        <WeatherIcon
          code={report.current.weatherCode}
          isDay={report.current.isDay}
          className="size-4"
        />
      ) : (
        <Cloud aria-hidden className="size-4 text-ink-faint" />
      )}
      <span className="text-[13px] font-semibold text-ink tabular-nums">
        {report ? formatTemperature(report.current.temperature) : '--'}
      </span>
    </div>
  );
}
