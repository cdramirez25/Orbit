import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { Compact } from '@/modules/demo/Compact';
import { useAudioStore } from '@/stores/audio.store';

beforeEach(() => {
  useAudioStore.setState({ listening: false });
});

describe('Compact (punto y ondas)', () => {
  it('dibuja cuatro barras de onda', () => {
    const { container } = render(<Compact />);
    expect(container.querySelectorAll('span[aria-hidden="true"].bg-accent')).toHaveLength(
      4 + 0, // las barras (el punto no lleva aria-hidden)
    );
  });

  it('sin escuchar el punto está apagado y no late', () => {
    const { container } = render(<Compact />);
    const dot = container.querySelector('span.size-2\\.5');
    expect(dot).toHaveClass('opacity-40');
    expect(dot).not.toHaveClass('orbit-pulse');
  });

  it('al escuchar el punto late', () => {
    const { container } = render(<Compact />);
    act(() => useAudioStore.setState({ listening: true }));
    const dot = container.querySelector('span.size-2\\.5');
    expect(dot).toHaveClass('orbit-pulse');
    expect(dot).not.toHaveClass('opacity-40');
  });
});
