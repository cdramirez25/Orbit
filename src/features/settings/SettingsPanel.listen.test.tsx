import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useAudioStore } from '@/stores/audio.store';

vi.mock('@/ipc/remote', () => ({
  remote: {
    sendCommand: vi.fn(),
    onState: vi.fn().mockResolvedValue(() => {}),
    requestState: vi.fn(),
  },
}));

vi.mock('@/ipc/commands', () => ({
  commands: {
    getAudioPermission: vi.fn(),
    requestAudioPermission: vi.fn(),
    openAudioPermissionSettings: vi.fn(),
    startListening: vi.fn(),
    stopListening: vi.fn(),
    isListening: vi.fn(),
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

async function renderPanel() {
  mocked.getAudioPermission.mockResolvedValue('granted');
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
  await act(async () => {}); // termina la primera consulta del permiso
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useAudioStore.setState({ permission: null, listening: false, errorCode: null });
});

describe('botón Escuchar del panel de ajustes', () => {
  it('Escuchar empieza a escuchar y el botón pasa a Parar', async () => {
    mocked.startListening.mockResolvedValue(undefined);
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Escuchar' }));
    });

    expect(mocked.startListening).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Parar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escuchar' })).not.toBeInTheDocument();
  });

  it('Parar deja de escuchar y vuelve a Escuchar', async () => {
    mocked.stopListening.mockResolvedValue(undefined);
    await renderPanel();
    act(() => useAudioStore.setState({ listening: true }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    });

    expect(mocked.stopListening).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Escuchar' })).toBeInTheDocument();
  });

  it('si no hay dispositivo de salida avisa con un mensaje', async () => {
    mocked.startListening.mockRejectedValue({ code: 'audio.noOutputDevice', message: 'x' });
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Escuchar' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Sin dispositivo de salida');
  });

  it('un fallo de permiso no repite el mensaje: ya lo dice el estado', async () => {
    mocked.startListening.mockRejectedValue({ code: 'audio.permissionDenied', message: 'x' });
    await renderPanel();
    // Al fallar el arranque se vuelve a consultar el permiso, que ahora consta como denegado.
    mocked.getAudioPermission.mockResolvedValue('denied');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Escuchar' }));
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Denegado');
    expect(screen.getByRole('button', { name: 'Abrir ajustes' })).toBeInTheDocument();
  });

  it('otro error muestra un mensaje genérico', async () => {
    mocked.startListening.mockRejectedValue({ code: 'audio.capture', message: 'x' });
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Escuchar' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo escuchar');
  });

  it('se traduce al inglés', async () => {
    useLocaleStore.setState({ locale: 'en' });
    await renderPanel();
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument();
    act(() => useAudioStore.setState({ listening: true }));
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });
});
