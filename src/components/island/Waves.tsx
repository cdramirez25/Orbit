import { motion, useSpring, useTransform, type MotionValue } from 'motion/react';

import { WAVES } from '@/lib/island/island.motion';

function Bar({ level, weight }: { level: MotionValue<number>; weight: number }) {
  // Solo `transform`: Motion escribe el valor en el DOM sin re-renderizar React.
  const scaleY = useTransform(
    level,
    (value) => WAVES.minScale + Math.min(1, value * weight * WAVES.gain) * (1 - WAVES.minScale),
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
 * Las ondas de la pastilla: cuatro barras que siguen un volumen (0–1) dado como `MotionValue`.
 * El volumen real del audio del sistema (escuchar) o uno simulado (música sonando).
 */
export function Waves({ level }: { level: MotionValue<number> }) {
  // Un spring suaviza los saltos entre lecturas (~30 por segundo).
  const smooth = useSpring(level, { stiffness: 420, damping: 30, mass: 0.6 });

  return (
    <div className="flex h-3.5 items-center gap-[3px]" aria-hidden>
      {WAVES.weights.map((weight, index) => (
        <Bar key={index} level={smooth} weight={weight} />
      ))}
    </div>
  );
}
