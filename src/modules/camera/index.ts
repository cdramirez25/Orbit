import { Camera } from 'lucide-react';

import { Compact } from '@/modules/camera/Compact';
import { Expanded } from '@/modules/camera/Expanded';
import type { OrbitModule } from '@/types';

export const CAMERA_MODULE_ID = 'camera';

/** Un espejo para verte antes de una llamada y tomar una foto rápida. La cámara solo se enciende con la tarjeta abierta. */
export const cameraModule: OrbitModule = {
  id: CAMERA_MODULE_ID,
  labelKey: 'camera.module',
  icon: Camera,
  priority: 0,
  ambient: true,
  Compact,
  Expanded,
};
