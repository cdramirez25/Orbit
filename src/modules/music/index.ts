import { Music2 } from 'lucide-react';

import { Compact } from '@/modules/music/Compact';
import { Expanded } from '@/modules/music/Expanded';
import type { OrbitModule } from '@/types';

export const MUSIC_MODULE_ID = 'music';

/** Lo que suena en el sistema (Spotify, Música, YouTube…) y sus controles, siempre en la isla. */
export const musicModule: OrbitModule = {
  id: MUSIC_MODULE_ID,
  labelKey: 'music.module',
  icon: Music2,
  priority: 0,
  ambient: true,
  Compact,
  Expanded,
};
