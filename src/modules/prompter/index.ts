import { Sparkles } from 'lucide-react';

import { Compact } from '@/modules/prompter/Compact';
import { Expanded } from '@/modules/prompter/Expanded';
import { PROMPTER_MODULE_ID } from '@/modules/prompter/id';
import type { OrbitModule } from '@/types';

export { PROMPTER_MODULE_ID };

/**
 * La IA, siempre en la isla: se elige la sesión, se graba la pregunta con el botón y la IA responde
 * con el contexto de toda la sesión y con el proveedor que el usuario cargó en Ajustes.
 */
export const prompterModule: OrbitModule = {
  id: PROMPTER_MODULE_ID,
  labelKey: 'prompter.module',
  icon: Sparkles,
  priority: 0,
  ambient: true,
  Compact,
  Expanded,
};
