import { Captions } from 'lucide-react';

import { Compact } from '@/modules/listen/Compact';
import { Expanded } from '@/modules/listen/Expanded';
import { LISTEN_MODULE_ID } from '@/modules/listen/id';
import type { OrbitModule } from '@/types';

export { LISTEN_MODULE_ID };

/**
 * La transcripción en vivo, sola: escucha el audio del sistema y muestra lo que entiende el modelo
 * de voz, sin IA de por medio. Sirve para comprobar que se transcribe bien y para elegir modelo.
 */
export const listenModule: OrbitModule = {
  id: LISTEN_MODULE_ID,
  labelKey: 'listen.module',
  icon: Captions,
  priority: 0,
  ambient: true,
  followEnd: true,
  Compact,
  Expanded,
};
