import { CloudSun } from 'lucide-react';

import { Compact } from '@/modules/weather/Compact';
import { Expanded } from '@/modules/weather/Expanded';
import type { OrbitModule } from '@/types';

export const WEATHER_MODULE_ID = 'weather';

/** Clima de la zona del usuario, siempre disponible en la isla. */
export const weatherModule: OrbitModule = {
  id: WEATHER_MODULE_ID,
  labelKey: 'weather.module',
  icon: CloudSun,
  priority: 0,
  ambient: true,
  Compact,
  Expanded,
};
