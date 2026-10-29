import { Gauge } from 'lucide-react';

import { Compact } from '@/modules/system/Compact';
import { Expanded } from '@/modules/system/Expanded';
import type { OrbitModule } from '@/types';

export const SYSTEM_MODULE_ID = 'system';

/** El equipo: batería (solo en portátiles), CPU, memoria y red, siempre disponible en la isla. */
export const systemModule: OrbitModule = {
  id: SYSTEM_MODULE_ID,
  labelKey: 'system.module',
  icon: Gauge,
  priority: 0,
  ambient: true,
  Compact,
  Expanded,
};
