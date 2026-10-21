import { useMotionValue, type MotionValue } from 'motion/react';
import { useEffect } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { simulatedLevel } from '@/lib/audio/simulated-level';
import { WAVES } from '@/lib/island/island.motion';

/**
 * Un volumen que se mueve solo mientras `active` es verdadero (la música suena), para animar las
 * ondas. Se escribe en un `MotionValue` cada frame, sin re-renderizar React. Con movimiento
 * reducido se queda quieto, y apagado vuelve a 0 (sin bucle de animación).
 */
export function useSimulatedLevel(active: boolean): MotionValue<number> {
  const level = useMotionValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!active) {
      level.set(0);
      return;
    }
    if (reduced) {
      level.set(WAVES.reducedLevel);
      return;
    }
    const startedAt = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      level.set(simulatedLevel((now - startedAt) / 1000));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, reduced, level]);

  return level;
}
