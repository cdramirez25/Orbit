import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from '@/components/ui';

describe('ProgressBar', () => {
  it('expone su avance a los lectores de pantalla', () => {
    render(<ProgressBar value={42} label="Descarga" />);
    const bar = screen.getByRole('progressbar', { name: 'Descarga' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('el avance se queda entre 0 y 100', () => {
    const { rerender } = render(<ProgressBar value={250} label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<ProgressBar value={-3} label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});
