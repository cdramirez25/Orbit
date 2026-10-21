import { Compact } from '@/modules/demo/Compact';
import { DEMO_MODULE_ID } from '@/modules/demo/demo.store';
import { Expanded } from '@/modules/demo/Expanded';
import type { OrbitModule } from '@/types';

/** Módulo de prueba de la Fase 1: ejercita el registro, el arbitraje y las vistas de la isla. */
export const demoModule: OrbitModule = {
  id: DEMO_MODULE_ID,
  name: 'Demo',
  icon: Compact,
  priority: 1,
  Compact,
  Expanded,
};
