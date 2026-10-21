import { ClipboardList } from 'lucide-react';

import { Compact } from '@/modules/clipboard/Compact';
import { Expanded } from '@/modules/clipboard/Expanded';
import type { OrbitModule } from '@/types';

export const CLIPBOARD_MODULE_ID = 'clipboard';

/** Historial de lo copiado en esta sesión (texto e imágenes), siempre disponible en la isla. */
export const clipboardModule: OrbitModule = {
  id: CLIPBOARD_MODULE_ID,
  labelKey: 'clipboard.module',
  icon: ClipboardList,
  priority: 0,
  ambient: true,
  Compact,
  Expanded,
};
