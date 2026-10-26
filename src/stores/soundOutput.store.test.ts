import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useSoundOutputStore } from '@/stores/soundOutput.store';
import type { SoundOutputDevice } from '@/types';

vi.mock('@/ipc/commands', () => ({
  commands: { soundOutputList: vi.fn(), soundOutputSet: vi.fn() },
}));

const mocked = vi.mocked(commands);

const device = (id: string, isDefault = false): SoundOutputDevice => ({
  id,
  name: id,
  isDefault,
});

beforeEach(() => {
  vi.clearAllMocks();
  useSoundOutputStore.setState({ devices: [], errorCode: null, switching: false });
});

describe('salida de sonido', () => {
  it('refresh guarda las salidas que da Rust', async () => {
    mocked.soundOutputList.mockResolvedValue([device('altavoces', true), device('audifonos')]);
    await useSoundOutputStore.getState().refresh();
    expect(useSoundOutputStore.getState().devices.map((d) => d.id)).toEqual([
      'altavoces',
      'audifonos',
    ]);
    expect(useSoundOutputStore.getState().errorCode).toBeNull();
  });

  it('si no se pueden leer, guarda el código y conserva la lista de antes', async () => {
    useSoundOutputStore.setState({ devices: [device('altavoces', true)] });
    mocked.soundOutputList.mockRejectedValue({ code: 'soundOutput.list', message: 'x' });

    await useSoundOutputStore.getState().refresh();

    expect(useSoundOutputStore.getState().errorCode).toBe('soundOutput.list');
    expect(useSoundOutputStore.getState().devices).toHaveLength(1);
  });

  it('elegir una salida la manda a Rust, marca que cambia y guarda la lista nueva', async () => {
    let finish: (devices: SoundOutputDevice[]) => void = () => {};
    mocked.soundOutputSet.mockImplementation(() => new Promise((resolve) => (finish = resolve)));

    const pending = useSoundOutputStore.getState().choose('audifonos');
    expect(useSoundOutputStore.getState().switching).toBe(true);
    finish([device('altavoces'), device('audifonos', true)]);
    await pending;

    expect(mocked.soundOutputSet).toHaveBeenCalledWith('audifonos');
    expect(useSoundOutputStore.getState().switching).toBe(false);
    expect(useSoundOutputStore.getState().devices.find((d) => d.isDefault)?.id).toBe('audifonos');
  });

  it('un fallo al cambiar deja de marcar que cambia y guarda su código; sin código, desconocido', async () => {
    mocked.soundOutputSet.mockRejectedValue({ code: 'soundOutput.notFound', message: 'x' });
    await useSoundOutputStore.getState().choose('quitada');
    expect(useSoundOutputStore.getState().errorCode).toBe('soundOutput.notFound');
    expect(useSoundOutputStore.getState().switching).toBe(false);

    mocked.soundOutputSet.mockRejectedValue(new Error('x'));
    await useSoundOutputStore.getState().choose('otra');
    expect(useSoundOutputStore.getState().errorCode).toBe('unknown');
  });
});
