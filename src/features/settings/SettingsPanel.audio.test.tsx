import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useAudioStore } from '@/stores/audio.store';
import type { PermissionStatus } from '@/types';

vi.mock('@/ipc/remote', () => ({
  remote: {
    sendCommand: vi.fn(),
    onState: vi.fn().mockResolvedValue(() => {}),
    requestState: vi.fn(),
  },
}));

vi.mock('@/ipc/commands', () => ({
  commands: {
    soundOutputList: vi.fn().mockResolvedValue([]),
    getAudioPermission: vi.fn(),
    requestAudioPermission: vi.fn(),
    openAudioPermissionSettings: vi.fn(),
    quitApp: vi.fn(),
    setContentProtected: vi.fn(),
    getIslandSettings: vi.fn(),
    setIslandAnchor: vi.fn(),
    getNotchInfo: vi.fn(),
    setIslandInteractive: vi.fn(),
    getPointerPosition: vi.fn(),
    getIslandOrigin: vi.fn(),
    setIslandOrigin: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

async function renderWith(status: PermissionStatus) {
  mocked.getAudioPermission.mockResolvedValue(status);
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
  await act(async () => {}); // deja que termine la primera consulta del permiso
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useAudioStore.setState({ permission: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fila de audio del panel de ajustes', () => {
  it('concedido: solo muestra el estado, sin botones', async () => {
    await renderWith('granted');
    expect(screen.getByRole('status')).toHaveTextContent('Permitido');
    expect(screen.queryByRole('button', { name: 'Pedir permiso' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir ajustes' })).not.toBeInTheDocument();
  });

  it('no requerido (Windows): solo muestra el estado, sin botones', async () => {
    await renderWith('notRequired');
    expect(screen.getByRole('status')).toHaveTextContent('No requerido');
    expect(screen.queryByRole('button', { name: 'Pedir permiso' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir ajustes' })).not.toBeInTheDocument();
  });

  it('sin pedir: ofrece pedirlo y, tras pedirlo sin concederse, pasa a denegado', async () => {
    mocked.requestAudioPermission.mockResolvedValue('denied');
    await renderWith('notDetermined');
    expect(screen.getByRole('status')).toHaveTextContent('Sin pedir');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pedir permiso' }));
    });

    expect(mocked.requestAudioPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Denegado');
    expect(screen.getByRole('button', { name: 'Abrir ajustes' })).toBeInTheDocument();
  });

  it('denegado: manda a Ajustes del Sistema y avisa de que hay que reiniciar', async () => {
    mocked.openAudioPermissionSettings.mockResolvedValue(undefined);
    await renderWith('denied');
    expect(screen.getByRole('status')).toHaveTextContent('Denegado');
    expect(screen.getByText('Reinicia Orbit tras darlo.')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Abrir ajustes' }));
    });
    expect(mocked.openAudioPermissionSettings).toHaveBeenCalledTimes(1);
  });

  it('se traduce al inglés', async () => {
    useLocaleStore.setState({ locale: 'en' });
    await renderWith('denied');
    expect(screen.getByRole('status')).toHaveTextContent('Denied');
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
    expect(screen.getByText('Restart Orbit after granting.')).toBeInTheDocument();
  });

  it('vuelve a consultar el permiso cada pocos segundos (el usuario lo concede en Ajustes)', async () => {
    vi.useFakeTimers();
    await renderWith('denied');
    expect(mocked.getAudioPermission).toHaveBeenCalledTimes(1);

    mocked.getAudioPermission.mockResolvedValue('granted');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(mocked.getAudioPermission).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Permitido');
  });
});
