import { Waves } from '@/components/island/Waves';
import { audioLevel } from '@/lib/audio/audio-level';
import { cn } from '@/lib/utils/cn';
import { useAudioStore } from '@/stores/audio.store';

/**
 * Punto "escuchando" a la izquierda y ondas a la derecha (el centro queda libre para el notch).
 * Las ondas siguen el volumen real del audio del sistema.
 */
export function Compact() {
  const listening = useAudioStore((s) => s.listening);

  return (
    <div className="flex h-full items-center justify-between px-5">
      <span
        className={cn('size-2.5 rounded-full bg-accent', listening ? 'orbit-pulse' : 'opacity-40')}
      />
      <Waves level={audioLevel} />
    </div>
  );
}
