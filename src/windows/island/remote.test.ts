import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { INITIAL_SNAPSHOT } from '@/lib/island/island.machine';
import { useDemoStore } from '@/modules/demo/demo.store';
import { useIslandStore } from '@/stores/island.store';
import { useSettingsStore } from '@/stores/settings.store';
import { applyRemoteCommand, currentRemoteState } from '@/windows/island/remote';

vi.mock('@/ipc/commands', () => ({
  commands: { setIslandAnchor: vi.fn().mockResolvedValue({ islandAnchor: 'left' }) },
}));
vi.mock('@/ipc/remote', () => ({ remote: {} }));

beforeEach(() => {
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useIslandStore.setState({ snapshot: INITIAL_SNAPSHOT, alert: null });
  useSettingsStore.setState({ islandStyle: 'floating', anchor: 'center' });
});

describe('control remoto de la isla', () => {
  it('describe el estado que la ventana de ajustes necesita', () => {
    expect(currentRemoteState()).toEqual({
      islandState: 'idle',
      style: 'floating',
      anchor: 'center',
    });
  });

  it('goTo lleva la isla al estado pedido', () => {
    applyRemoteCommand({ type: 'goTo', state: 'compact' });
    expect(useIslandStore.getState().snapshot.state).toBe('compact');
  });

  it('simulate y alert usan el módulo de demostración', () => {
    const streamAnswer = vi
      .spyOn(useDemoStore.getState(), 'streamAnswer')
      .mockImplementation(() => {});
    const showAlert = vi
      .spyOn(useDemoStore.getState(), 'showDemoAlert')
      .mockImplementation(() => {});
    applyRemoteCommand({ type: 'simulate' });
    applyRemoteCommand({ type: 'alert' });
    expect(streamAnswer).toHaveBeenCalledTimes(1);
    expect(showAlert).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('setStyle y setAnchor cambian los ajustes de la isla', () => {
    applyRemoteCommand({ type: 'setStyle', style: 'attached' });
    applyRemoteCommand({ type: 'setAnchor', anchor: 'left' });
    expect(useSettingsStore.getState().islandStyle).toBe('attached');
    expect(useSettingsStore.getState().anchor).toBe('left');
  });

  it('setLocale cambia el idioma de la isla', () => {
    applyRemoteCommand({ type: 'setLocale', locale: 'en' });
    expect(useLocaleStore.getState().locale).toBe('en');
  });
});
