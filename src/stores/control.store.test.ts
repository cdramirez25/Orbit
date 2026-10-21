import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { remote } from '@/ipc/remote';
import { useControlStore } from '@/stores/control.store';
import type { RemoteState } from '@/types';

vi.mock('@/ipc/commands', () => ({ commands: { quitApp: vi.fn() } }));
vi.mock('@/ipc/remote', () => ({
  remote: {
    sendCommand: vi.fn().mockResolvedValue(undefined),
    onState: vi.fn(),
    requestState: vi.fn().mockResolvedValue(undefined),
  },
}));

const mocked = vi.mocked(remote);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useControlStore.setState({ islandState: 'idle', style: 'floating', anchor: 'center' });
});

describe('control.store', () => {
  it('goTo cambia el espejo y manda la orden', () => {
    useControlStore.getState().goTo('expanded');
    expect(useControlStore.getState().islandState).toBe('expanded');
    expect(mocked.sendCommand).toHaveBeenCalledWith({ type: 'goTo', state: 'expanded' });
  });

  it('setAnchor y setStyle cambian el espejo y mandan la orden', () => {
    useControlStore.getState().setAnchor('free');
    useControlStore.getState().setStyle('attached');
    expect(useControlStore.getState()).toMatchObject({ anchor: 'free', style: 'attached' });
    expect(mocked.sendCommand).toHaveBeenCalledWith({ type: 'setAnchor', anchor: 'free' });
    expect(mocked.sendCommand).toHaveBeenCalledWith({ type: 'setStyle', style: 'attached' });
  });

  it('simulate y alert solo mandan la orden', () => {
    useControlStore.getState().simulate();
    useControlStore.getState().alert();
    expect(mocked.sendCommand).toHaveBeenCalledWith({ type: 'simulate' });
    expect(mocked.sendCommand).toHaveBeenCalledWith({ type: 'alert' });
    expect(useControlStore.getState().islandState).toBe('idle');
  });

  it('setLocale cambia el idioma de esta ventana y avisa a la isla', () => {
    useControlStore.getState().setLocale('en');
    expect(useLocaleStore.getState().locale).toBe('en');
    expect(mocked.sendCommand).toHaveBeenCalledWith({ type: 'setLocale', locale: 'en' });
  });

  it('bind pide el estado y se actualiza con lo que publica la isla', async () => {
    let publish: (state: RemoteState) => void = () => {};
    mocked.onState.mockImplementation((handler) => {
      publish = handler;
      return Promise.resolve(() => {});
    });

    await useControlStore.getState().bind();
    expect(mocked.requestState).toHaveBeenCalledTimes(1);

    publish({ islandState: 'alert', style: 'attached', anchor: 'right' });
    expect(useControlStore.getState()).toMatchObject({
      islandState: 'alert',
      style: 'attached',
      anchor: 'right',
    });
  });
});
