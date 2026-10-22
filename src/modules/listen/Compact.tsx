import { Captions } from 'lucide-react';

import { Waves } from '@/components/island/Waves';
import { useT } from '@/i18n/useT';
import { audioLevel } from '@/lib/audio/audio-level';
import { cn } from '@/lib/utils/cn';
import { useAudioStore } from '@/stores/audio.store';

/** Pastilla: el icono de subtítulos a la izquierda y, mientras se escucha, las ondas del audio. */
export function Compact() {
  const t = useT();
  const listening = useAudioStore((s) => s.listening);

  return (
    <div className="flex h-full items-center justify-between px-5">
      <Captions
        aria-hidden
        className={cn('size-4', listening ? 'orbit-pulse text-accent' : 'text-ink-faint')}
      />
      <span className="sr-only">{t(listening ? 'listen.status.on' : 'listen.status.off')}</span>
      {listening && <Waves level={audioLevel} />}
    </div>
  );
}
