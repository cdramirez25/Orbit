import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { useGuideStore } from '@/stores/guide.store';
import { App } from '@/windows/settings/App';

vi.mock('@/features/onboarding/Onboarding', () => ({
  Onboarding: () => <p>guía de primer arranque</p>,
}));
vi.mock('@/features/settings/SettingsPanel', () => ({
  SettingsPanel: () => <p>panel de ajustes</p>,
}));

beforeEach(() => {
  useLocaleStore.setState({ locale: 'es' });
});

describe('ventana de ajustes', () => {
  it('muestra los ajustes si no toca ver la guía', () => {
    useGuideStore.setState({ visible: false });
    render(<App />);
    expect(screen.getByText('panel de ajustes')).toBeInTheDocument();
    expect(screen.queryByText('guía de primer arranque')).not.toBeInTheDocument();
  });

  it('muestra la guía en lugar de los ajustes mientras toca verla', () => {
    useGuideStore.setState({ visible: true });
    render(<App />);
    expect(screen.getByText('guía de primer arranque')).toBeInTheDocument();
    expect(screen.queryByText('panel de ajustes')).not.toBeInTheDocument();
  });
});
