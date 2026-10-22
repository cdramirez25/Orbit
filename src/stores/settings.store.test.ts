import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useSettingsStore } from '@/stores/settings.store';
import type { IslandSettings } from '@/types';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getIslandSettings: vi.fn(),
    setOnboardingDone: vi.fn(),
    setSttLanguage: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const saved = (overrides: Partial<IslandSettings> = {}): IslandSettings => ({
  hideFromScreenShare: true,
  islandAnchor: 'center',
  freeOrigin: null,
  sttLanguage: 'auto',
  onboardingDone: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ onboardingDone: true, sttLanguage: 'auto' });
});

describe('store de ajustes', () => {
  it('load trae lo guardado, incluido si la guía ya se vio', async () => {
    mocked.getIslandSettings.mockResolvedValue(saved({ onboardingDone: false, sttLanguage: 'es' }));
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().onboardingDone).toBe(false);
    expect(useSettingsStore.getState().sttLanguage).toBe('es');
  });

  it('hasta que se cargan, la guía cuenta como vista (no sale por error al abrir)', () => {
    expect(useSettingsStore.getState().onboardingDone).toBe(true);
  });

  it('setOnboardingDone lo guarda en Rust y se queda con lo que confirma', async () => {
    mocked.setOnboardingDone.mockResolvedValue(saved({ onboardingDone: true }));
    await useSettingsStore.getState().setOnboardingDone(true);
    expect(mocked.setOnboardingDone).toHaveBeenCalledWith(true);
    expect(useSettingsStore.getState().onboardingDone).toBe(true);
  });

  it('si Rust no puede guardarlo, se conserva el valor local', async () => {
    useSettingsStore.setState({ onboardingDone: false });
    mocked.setOnboardingDone.mockRejectedValue(new Error('x'));
    await useSettingsStore.getState().setOnboardingDone(true);
    expect(useSettingsStore.getState().onboardingDone).toBe(true);
  });
});
