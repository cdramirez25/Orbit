import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModuleSwitcher } from '@/components/island/ModuleSwitcher';
import { useLocaleStore } from '@/i18n/locale.store';
import { clipboardModule } from '@/modules/clipboard';
import { weatherModule } from '@/modules/weather';

describe('ModuleSwitcher', () => {
  it('marca el módulo activo y muestra solo su nombre', () => {
    useLocaleStore.setState({ locale: 'es' });
    render(
      <ModuleSwitcher
        modules={[weatherModule, clipboardModule]}
        activeId="weather"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Módulos de la isla' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Clima' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Portapapeles' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tab', { name: 'Clima' })).toHaveTextContent('Clima');
    expect(screen.getByRole('tab', { name: 'Portapapeles' })).not.toHaveTextContent('Portapapeles');
  });

  it('al pulsar una pestaña avisa cuál se eligió', () => {
    useLocaleStore.setState({ locale: 'en' });
    const onSelect = vi.fn();
    render(
      <ModuleSwitcher
        modules={[weatherModule, clipboardModule]}
        activeId="weather"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Clipboard' }));
    expect(onSelect).toHaveBeenCalledWith('clipboard');
  });
});
