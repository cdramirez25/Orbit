import { motion, useSpring, useTransform, type MotionValue } from 'motion/react';

import { audioLevel } from '@/lib/audio/audio-level';
import { cn } from '@/lib/utils/cn';
import { useAudioStore } from '@/stores/audio.store';

/** Alto mínimo de una barra en silencio (fracción del alto total). */
const MIN_SCALE = 0.2;
/** Cuánto responde cada barra al volumen: la del centro es la más viva. */
const BAR_WEIGHTS = [0.7, 1, 0.85, 0.55] as const;
/** El volumen típico de música o voz ronda 0.5–0.8; se amplifica un poco para que se note. */
const GAIN = 1.25;

function Bar({ level, weight }: { level: MotionValue<number>; weight: number }) {
  // Solo `transform`: Motion escribe el valor en el DOM sin re-renderizar React.
  const scaleY = useTransform(
    level,
    (value) => MIN_SCALE + Math.min(1, value * weight * GAIN) * (1 - MIN_SCALE),
  );
  return (
    <motion.span
      aria-hidden
      className="h-full w-[3px] origin-center rounded-full bg-accent"
      style={{ scaleY }}
    />
  );
}

/**
 * Punto "escuchando" a la izquierda y ondas a la derecha (el centro queda libre para el notch).
 * Las ondas siguen el volumen real del audio del sistema.
 */
export function Compact() {
  const listening = useAudioStore((s) => s.listening);
  // Un spring suaviza los saltos entre lecturas (~30 por segundo).
  const level = useSpring(audioLevel, { stiffness: 420, damping: 30, mass: 0.6 });

  return (
    <div className="flex h-full items-center justify-between px-5">
      <span
        className={cn('size-2.5 rounded-full bg-accent', listening ? 'orbit-pulse' : 'opacity-40')}
      />
      <div className="flex h-3.5 items-center gap-[3px]" aria-hidden>
        {BAR_WEIGHTS.map((weight, index) => (
          <Bar key={index} level={level} weight={weight} />
        ))}
      </div>
    </div>
  );
}
