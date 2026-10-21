import { render } from '@testing-library/react';
import { motionValue } from 'motion/react';
import { describe, expect, it } from 'vitest';

import { Waves } from '@/components/island/Waves';
import { WAVES } from '@/lib/island/island.motion';

describe('Waves', () => {
  it('dibuja una barra por cada peso de las ondas', () => {
    const { container } = render(<Waves level={motionValue(0)} />);
    expect(container.querySelectorAll('span[aria-hidden="true"].bg-accent')).toHaveLength(
      WAVES.weights.length,
    );
  });

  it('es decorativa: el lector de pantalla la ignora', () => {
    const { container } = render(<Waves level={motionValue(0.5)} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
