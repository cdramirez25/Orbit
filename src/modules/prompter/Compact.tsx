import { Sparkles } from 'lucide-react';

import { Waves } from '@/components/island/Waves';
import { audioLevel } from '@/lib/audio/audio-level';
import { cn } from '@/lib/utils/cn';
import { useAudioStore } from '@/stores/audio.store';
import { useQuestionStore } from '@/stores/question.store';

/**
 * Pastilla: el icono de IA a la izquierda (con color mientras se graba o se escucha) y, a la
 * derecha, las ondas que siguen el volumen real del audio del sistema.
 */
export function Compact() {
  const listening = useAudioStore((s) => s.listening);
  const recording = useQuestionStore((s) => s.recording);

  return (
    <div className="flex h-full items-center justify-between px-5">
      <Sparkles
        aria-hidden
        className={cn(
          'size-4',
          listening || recording ? 'orbit-pulse text-accent' : 'text-ink-faint',
        )}
      />
      {listening && <Waves level={audioLevel} />}
    </div>
  );
}
