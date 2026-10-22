import { describe, expect, it } from 'vitest';

import { formatBytes, percentOf } from '@/lib/utils/bytes';

describe('formatBytes', () => {
  it('usa MB por debajo del giga y GB por encima', () => {
    expect(formatBytes(487_601_967)).toBe('488 MB');
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(1_500_000_000)).toBe('1.5 GB');
  });

  it('no muestra tamaños negativos', () => {
    expect(formatBytes(-5)).toBe('0 MB');
  });
});

describe('percentOf', () => {
  it('redondea hacia abajo y se queda entre 0 y 100', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 5)).toBe(100);
    expect(percentOf(9, 5)).toBe(100);
    expect(percentOf(-1, 5)).toBe(0);
  });

  it('sin total no hay porcentaje', () => {
    expect(percentOf(10, 0)).toBe(0);
  });
});
