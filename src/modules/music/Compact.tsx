import { AudioLines, Music2, Pause } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import { useMediaStore } from '@/stores/media.store';

/** Pastilla: nota musical a la izquierda y, a la derecha, si está sonando o en pausa. */
export function Compact() {
  const nowPlaying = useMediaStore((s) => s.nowPlaying);

  return (
    <div className="flex h-full items-center justify-between px-5">
      <Music2
        aria-hidden
        className={cn('size-4', nowPlaying?.playing ? 'text-accent' : 'text-ink-faint')}
      />
      {nowPlaying?.playing && <AudioLines aria-hidden className="size-4 text-accent" />}
      {nowPlaying && !nowPlaying.playing && <Pause aria-hidden className="size-4 text-ink-dim" />}
    </div>
  );
}
