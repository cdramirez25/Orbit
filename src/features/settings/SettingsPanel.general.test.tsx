import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { useAutostartStore } from '@/stores/autostart.store';
import { useGuideStore } from '@/stores/guide.store';
import { useShortcutStore } from '@/stores/shortcuts.store';

vi.mock('@/ipc/remote', () => ({
  remote: {
    sendCommand: vi.fn(),
    onState: vi.fn().mockResolvedValue(() => {}),
    requestState: vi.fn(),
  },
}));

vi.mock('@/ipc/commands', () => ({
  commands: {
    getAudioPermission: vi.fn().mockResolvedValue('notRequired'),
    quitApp: vi.fn(),
    setContentProtected: vi.fn(),
    getAutostart: vi.fn(),
    setAutostart: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

async function openGeneral() {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'General' }));
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useAutostartStore.setState({ enabled: null, failed: false });
  useGuideStore.setState({ visible: false });
  useShortcutStore.setState({ shortcuts: [], error: null });
});

describe('inicio con la sesión', () => {
  it('muestra el interruptor con lo que dice el sistema', async () => {
    mocked.getAutostart.mockResolvedValue(true);
    await openGeneral();

    const toggle = screen.getByRole('switch', { name: 'Abrir Orbit al iniciar sesión' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByText('Orbit arranca solo cuando entras a tu computadora.'),
    ).toBeInTheDocument();
  });

  it('al encenderlo se lo pide a Rust y se ve encendido', async () => {
    mocked.getAutostart.mockResolvedValue(false);
    mocked.setAutostart.mockResolvedValue(true);
    await openGeneral();

    fireEvent.click(screen.getByRole('switch', { name: 'Abrir Orbit al iniciar sesión' }));
    await act(async () => {});

    expect(mocked.setAutostart).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch', { name: 'Abrir Orbit al iniciar sesión' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('si el sistema no deja cambiarlo, lo dice y el interruptor se queda como estaba', async () => {
    mocked.getAutostart.mockResolvedValue(false);
    mocked.setAutostart.mockRejectedValue({ code: 'autostart.failed', message: 'x' });
    await openGeneral();

    fireEvent.click(screen.getByRole('switch', { name: 'Abrir Orbit al iniciar sesión' }));
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cambiar');
    expect(screen.getByRole('switch', { name: 'Abrir Orbit al iniciar sesión' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('si no se puede consultar, no muestra el interruptor', async () => {
    mocked.getAutostart.mockRejectedValue(new Error('sin respuesta'));
    await openGeneral();
    expect(screen.queryByRole('switch', { name: 'Abrir Orbit al iniciar sesión' })).toBeNull();
  });
});

describe('guía de primer arranque desde General', () => {
  it('el botón vuelve a mostrar la guía', async () => {
    mocked.getAutostart.mockResolvedValue(false);
    await openGeneral();
    expect(useGuideStore.getState().visible).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Ver la guía de primer arranque' }));

    expect(useGuideStore.getState().visible).toBe(true);
  });
});
