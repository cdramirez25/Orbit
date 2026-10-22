import { Coffee } from 'lucide-react';

import { Compact } from '@/modules/awake/Compact';
import { Expanded } from '@/modules/awake/Expanded';
import type { OrbitModule } from '@/types';

export const AWAKE_MODULE_ID = 'awake';

/** Mantiene la pantalla encendida durante un rato, en un horario diario o hasta que se desactive. */
export const awakeModule: OrbitModule = {
  id: AWAKE_MODULE_ID,
  labelKey: 'awake.module',
  icon: Coffee,
  priority: 0,
  ambient: true,
  Compact,
  Expanded,
};
