import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { bindTrayLabels, trayLabels } from '@/windows/island/tray';

vi.mock('@/ipc/commands', () => ({
  commands: { setTrayLabels: vi.fn() },
}));

const mocked = vi.mocked(commands);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.setTrayLabels.mockResolvedValue();
  useLocaleStore.setState({ locale: 'es' });
});

describe('rótulos de la bandeja', () => {
  it('salen en el idioma activo', () => {
    expect(trayLabels()).toEqual({
      toggleIsland: 'Mostrar u ocultar la isla',
      settings: 'Ajustes',
      quit: 'Salir de Orbit',
    });
    useLocaleStore.setState({ locale: 'en' });
    expect(trayLabels().quit).toBe('Quit Orbit');
  });

  it('al enlazar manda los rótulos y los vuelve a mandar al cambiar de idioma', () => {
    const off = bindTrayLabels();
    expect(mocked.setTrayLabels).toHaveBeenCalledTimes(1);
    expect(mocked.setTrayLabels).toHaveBeenLastCalledWith(
      expect.objectContaining({ settings: 'Ajustes' }),
    );

    useLocaleStore.setState({ locale: 'en' });
    expect(mocked.setTrayLabels).toHaveBeenCalledTimes(2);
    expect(mocked.setTrayLabels).toHaveBeenLastCalledWith(
      expect.objectContaining({ settings: 'Settings' }),
    );

    off();
    useLocaleStore.setState({ locale: 'es' });
    expect(mocked.setTrayLabels).toHaveBeenCalledTimes(2);
  });

  it('si la bandeja no responde, no rompe nada', async () => {
    mocked.setTrayLabels.mockRejectedValue(new Error('sin bandeja'));
    expect(() => bindTrayLabels()()).not.toThrow();
    await Promise.resolve();
  });
});
