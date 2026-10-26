import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { useSoundOutputStore } from '@/stores/soundOutput.store';
import type { SoundOutputDevice } from '@/types';

vi.mock('@/ipc/remote', () => ({
  remote: {
    sendCommand: vi.fn(),
    onState: vi.fn().mockResolvedValue(() => {}),
    requestState: vi.fn(),
  },
}));

vi.mock('@/ipc/commands', () => ({
  commands: {
    getAudioPermission: vi.fn().mockResolvedValue('granted'),
    quitApp: vi.fn(),
    setContentProtected: vi.fn(),
    soundOutputList: vi.fn(),
    soundOutputSet: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const SPEAKERS: SoundOutputDevice[] = [
  { id: 'altavoces', name: 'Altavoces del equipo', isDefault: true },
  { id: 'astro', name: 'Astro A50 Game', isDefault: false },
];
const HEADSET: SoundOutputDevice[] = SPEAKERS.map((device) => ({
  ...device,
  isDefault: device.id === 'astro',
}));

async function openAudio(devices = SPEAKERS) {
  mocked.soundOutputList.mockResolvedValue(devices);
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useSoundOutputStore.setState({ devices: [], errorCode: null, switching: false });
  mocked.getAudioPermission.mockResolvedValue('granted');
});

describe('salida de sonido en Ajustes, Audio', () => {
  it('lista las salidas y marca la que usa el sistema', async () => {
    await openAudio();

    const select = screen.getByRole('combobox', { name: 'Salida de sonido del equipo' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Altavoces del equipo', 'Astro A50 Game']);
    expect(select).toHaveValue('altavoces');
    expect(screen.getByText(/igual que en los Ajustes del sistema/)).toBeInTheDocument();
  });

  it('elegir los audífonos le pide a Rust el cambio y los marca', async () => {
    mocked.soundOutputSet.mockResolvedValue(HEADSET);
    await openAudio();

    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Salida de sonido del equipo' }), {
        target: { value: 'astro' },
      });
    });

    expect(mocked.soundOutputSet).toHaveBeenCalledWith('astro');
    expect(screen.getByRole('combobox', { name: 'Salida de sonido del equipo' })).toHaveValue(
      'astro',
    );
  });

  it('al volver a la ventana vuelve a leer las salidas (por si se conectaron unos audífonos)', async () => {
    await openAudio();
    mocked.soundOutputList.mockClear();
    mocked.soundOutputList.mockResolvedValue(HEADSET);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(mocked.soundOutputList).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: 'Salida de sonido del equipo' })).toHaveValue(
      'astro',
    );
  });

  it('si la salida elegida ya no está, lo dice', async () => {
    mocked.soundOutputSet.mockRejectedValue({ code: 'soundOutput.notFound', message: 'x' });
    await openAudio();

    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Salida de sonido del equipo' }), {
        target: { value: 'astro' },
      });
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Esa salida de sonido ya no está conectada',
    );
  });

  it('sin salidas, el selector queda desactivado', async () => {
    await openAudio([]);
    expect(screen.getByRole('combobox', { name: 'Salida de sonido del equipo' })).toBeDisabled();
  });

  it('en inglés, los textos salen en inglés', async () => {
    useLocaleStore.setState({ locale: 'en' });
    mocked.soundOutputList.mockResolvedValue(SPEAKERS);
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    await act(async () => {});

    expect(screen.getByText('Sound output')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Computer sound output' })).toBeInTheDocument();
  });
});
