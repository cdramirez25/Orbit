import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useAutostartStore } from '@/stores/autostart.store';

vi.mock('@/ipc/commands', () => ({
  commands: { getAutostart: vi.fn(), setAutostart: vi.fn() },
}));

const mocked = vi.mocked(commands);

beforeEach(() => {
  vi.clearAllMocks();
  useAutostartStore.setState({ enabled: null, failed: false });
});

describe('store del inicio con la sesión', () => {
  it('load guarda lo que dice el sistema y, si no responde, no inventa nada', async () => {
    mocked.getAutostart.mockResolvedValue(true);
    await useAutostartStore.getState().load();
    expect(useAutostartStore.getState().enabled).toBe(true);

    useAutostartStore.setState({ enabled: null });
    mocked.getAutostart.mockRejectedValue(new Error('x'));
    await useAutostartStore.getState().load();
    expect(useAutostartStore.getState().enabled).toBeNull();
  });

  it('set guarda cómo quedó según el sistema, no lo que se pidió', async () => {
    mocked.setAutostart.mockResolvedValue(false);
    await useAutostartStore.getState().set(true);
    expect(mocked.setAutostart).toHaveBeenCalledWith(true);
    expect(useAutostartStore.getState().enabled).toBe(false);
  });

  it('set que falla lo marca y no cambia el valor; el siguiente intento lo limpia', async () => {
    useAutostartStore.setState({ enabled: false });
    mocked.setAutostart.mockRejectedValueOnce(new Error('x'));
    await useAutostartStore.getState().set(true);
    expect(useAutostartStore.getState()).toMatchObject({ enabled: false, failed: true });

    mocked.setAutostart.mockResolvedValue(true);
    await useAutostartStore.getState().set(true);
    expect(useAutostartStore.getState()).toMatchObject({ enabled: true, failed: false });
  });
});
