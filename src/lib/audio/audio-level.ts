import { motionValue } from 'motion/react';

/**
 * Volumen actual del audio del sistema (0–1), que llega ~30 veces por segundo desde Rust.
 * Es un `MotionValue`: las ondas lo leen directamente y se pintan sin re-renderizar React.
 */
export const audioLevel = motionValue(0);
