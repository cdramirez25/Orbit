import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSimulatedLevel } from '@/hooks/useSimulatedLevel';
import { WAVES } from '@/lib/island/island.motion';

let reduced = false;

beforeEach(() => {
  reduced = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      matches: reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSimulatedLevel', () => {
  it('apagado se queda en cero', () => {
    const { result } = renderHook(() => useSimulatedLevel(false));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.get()).toBe(0);
  });

  it('encendido se mueve con el tiempo, siempre entre 0 y 1', () => {
    const { result } = renderHook(() => useSimulatedLevel(true));
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      act(() => {
        vi.advanceTimersByTime(40);
      });
      const level = result.current.get();
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
      seen.add(level.toFixed(3));
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('al apagarse vuelve a cero y deja de animar', () => {
    const { result, rerender } = renderHook(({ on }) => useSimulatedLevel(on), {
      initialProps: { on: true },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ on: false });
    expect(result.current.get()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.get()).toBe(0);
  });

  it('con movimiento reducido se queda quieto a media altura', () => {
    reduced = true;
    const { result } = renderHook(() => useSimulatedLevel(true));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.get()).toBe(WAVES.reducedLevel);
  });
});
