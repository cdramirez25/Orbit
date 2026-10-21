import { describe, expect, it } from 'vitest';

import { simulatedLevel } from '@/lib/audio/simulated-level';

describe('simulatedLevel', () => {
  it('siempre queda entre 0 y 1', () => {
    for (let seconds = 0; seconds < 60; seconds += 0.037) {
      const level = simulatedLevel(seconds);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

  it('se mueve: no es un valor fijo', () => {
    const levels = new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((s) => simulatedLevel(s).toFixed(3)));
    expect(levels.size).toBeGreaterThan(3);
  });
});
