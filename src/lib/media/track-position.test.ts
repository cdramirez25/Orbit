import { describe, expect, it } from 'vitest';

import { trackPosition } from '@/lib/media/track-position';
import { nowPlaying } from '@/test/factories';

describe('trackPosition', () => {
  const base = nowPlaying({ duration: 200, position: 50, positionAtMs: 10_000 });

  it('mientras suena avanza con el reloj', () => {
    expect(trackPosition(base, 10_000)).toBe(50);
    expect(trackPosition(base, 13_500)).toBe(53.5);
  });

  it('en pausa se queda donde estaba', () => {
    expect(trackPosition({ ...base, playing: false }, 60_000)).toBe(50);
  });

  it('nunca pasa de la duración ni baja de cero', () => {
    expect(trackPosition(base, 10_000 + 999_000)).toBe(200);
    expect(trackPosition({ ...base, position: -5, playing: false }, 0)).toBe(0);
  });

  it('un reloj atrasado no la hace retroceder', () => {
    expect(trackPosition(base, 5_000)).toBe(50);
  });

  it('sin duración o sin posición no hay barra', () => {
    expect(trackPosition({ ...base, duration: null }, 20_000)).toBeNull();
    expect(trackPosition({ ...base, position: null }, 20_000)).toBeNull();
    expect(trackPosition({ ...base, positionAtMs: null }, 20_000)).toBeNull();
  });
});
