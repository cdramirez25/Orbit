import { motion } from 'motion/react';

import { SHAPE } from '@/lib/island/island.motion';

/**
 * "Orejas": curvas inversas que empalman la isla `attached` con el borde superior / el notch.
 * Cuelgan fuera de los lados del contenedor (por eso éste no puede recortar) y siguen su ancho
 * porque son hijas suyas; solo se desvanecen en estilo `floating`.
 */
export function NotchShape({ visible }: { visible: boolean }) {
  const r = SHAPE.earRadius;

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0"
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.2 }}
    >
      <svg
        className="absolute top-0"
        style={{ left: -r }}
        width={r}
        height={r}
        viewBox={`0 0 ${r} ${r}`}
      >
        <path d={`M${r} 0 L${r} ${r} A${r} ${r} 0 0 0 0 0 Z`} fill="var(--island-bg)" />
      </svg>
      <svg
        className="absolute top-0"
        style={{ right: -r }}
        width={r}
        height={r}
        viewBox={`0 0 ${r} ${r}`}
      >
        <path d={`M0 0 L0 ${r} A${r} ${r} 0 0 1 ${r} 0 Z`} fill="var(--island-bg)" />
      </svg>
    </motion.div>
  );
}
