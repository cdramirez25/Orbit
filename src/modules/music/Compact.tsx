import { Music2, Pause } from 'lucide-react';

import { Waves } from '@/components/island/Waves';
import { useSimulatedLevel } from '@/hooks/useSimulatedLevel';
import { cn } from '@/lib/utils/cn';
import { useMediaStore } from '@/stores/media.store';

/**
 * Pastilla: nota musical a la izquierda y, a la derecha, las mismas ondas que al escuchar (se
 * mueven mientras suena) o el icono de pausa.
 */
export function Compact() {
  const nowPlaying = useMediaStore((s) => s.nowPlaying);
  const playing = nowPlaying?.playing === true;
  const level = useSimulatedLevel(playing);

  return (
    <div className="flex h-full items-center justify-between px-5">
      <Music2 aria-hidden className={cn('size-4', playing ? 'text-accent' : 'text-ink-faint')} />
      {playing && <Waves level={level} />}
      {nowPlaying && !playing && <Pause aria-hidden className="size-4 text-ink-dim" />}
    </div>
  );
}
