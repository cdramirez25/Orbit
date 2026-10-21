import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react';

import { weatherKind, type WeatherKind } from '@/lib/weather/weather-kind';
import { cn } from '@/lib/utils/cn';

const DAY_ICONS: Record<WeatherKind, LucideIcon> = {
  clear: Sun,
  partlyCloudy: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  thunderstorm: CloudLightning,
};

/** De noche el sol y el sol con nubes se dibujan como luna. */
const NIGHT_ICONS: Partial<Record<WeatherKind, LucideIcon>> = {
  clear: Moon,
  partlyCloudy: CloudMoon,
};

interface WeatherIconProps {
  /** Código meteorológico WMO. */
  code: number;
  isDay: boolean;
  className?: string;
}

export function WeatherIcon({ code, isDay, className }: WeatherIconProps) {
  const kind = weatherKind(code);
  const Icon = (!isDay && NIGHT_ICONS[kind]) || DAY_ICONS[kind];
  const sunny = isDay && (kind === 'clear' || kind === 'partlyCloudy');
  return <Icon aria-hidden className={cn(sunny ? 'text-amber-300' : 'text-ink', className)} />;
}
