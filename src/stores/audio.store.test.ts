import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useAudioStore } from '@/stores/audio.store';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getAudioPermission: vi.fn(),
    requestAudioPermission: vi.fn(),
    openAudioPermissionSettings: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

beforeEach(() => {
  vi.clearAllMocks();
  useAudioStore.setState({ permission: null });
});

describe('audio.store', () => {
  it('arranca sin estado hasta que se consulta', () => {
    expect(useAudioStore.getState().permission).toBeNull();
  });

  it('refresh guarda el estado que devuelve el sistema', async () => {
    mocked.getAudioPermission.mockResolvedValue('notDetermined');
    await useAudioStore.getState().refresh();
    expect(useAudioStore.getState().permission).toBe('notDetermined');

    mocked.getAudioPermission.mockResolvedValue('granted');
    await useAudioStore.getState().refresh();
    expect(useAudioStore.getState().permission).toBe('granted');
  });

  it('request pide el permiso y guarda el estado resultante', async () => {
    mocked.requestAudioPermission.mockResolvedValue('denied');
    await useAudioStore.getState().request();
    expect(mocked.requestAudioPermission).toHaveBeenCalledTimes(1);
    expect(useAudioStore.getState().permission).toBe('denied');
  });

  it('openSettings abre los ajustes del sistema', async () => {
    mocked.openAudioPermissionSettings.mockResolvedValue(undefined);
    await useAudioStore.getState().openSettings();
    expect(mocked.openAudioPermissionSettings).toHaveBeenCalledTimes(1);
  });

  it('si la consulta falla conserva el último estado conocido', async () => {
    useAudioStore.setState({ permission: 'granted' });
    mocked.getAudioPermission.mockRejectedValue(new Error('sin respuesta'));
    await useAudioStore.getState().refresh();
    expect(useAudioStore.getState().permission).toBe('granted');
  });

  it('si falla abrir los ajustes no revienta', async () => {
    mocked.openAudioPermissionSettings.mockRejectedValue(new Error('no se pudo'));
    await expect(useAudioStore.getState().openSettings()).resolves.toBeUndefined();
  });
});
