import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { IslandContent } from '@/components/island/IslandContent';
import { useLocaleStore } from '@/i18n/locale.store';
import { clipboardModule } from '@/modules/clipboard';
import { useRegistryStore } from '@/modules/registry';
import { weatherModule } from '@/modules/weather';
import { useSettingsWindowStore } from '@/stores/settingsWindow.store';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getWeather: vi.fn().mockRejectedValue(new Error('offline')),
    getClipboardHistory: vi.fn().mockResolvedValue([]),
  },
}));

beforeAll(() => {
  // jsdom no trae `matchMedia` ni `ResizeObserver`, que usan la isla y su tarjeta.
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  const registry = useRegistryStore.getState();
  registry.register(weatherModule);
  registry.register(clipboardModule);
  registry.startActivity(weatherModule.id);
  registry.startActivity(clipboardModule.id);
});

describe('engranaje de la tarjeta', () => {
  it('abre la ventana de ajustes', () => {
    const open = vi.fn();
    useSettingsWindowStore.setState({ open });
    render(
      <IslandContent
        state="expanded"
        style="floating"
        notch={null}
        topInset={0}
        onMeasure={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ajustes' }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
