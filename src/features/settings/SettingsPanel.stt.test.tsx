import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { useModelStore } from '@/stores/model.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useShortcutStore } from '@/stores/shortcuts.store';
import type { ModelStatus } from '@/types';

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
    requestAudioPermission: vi.fn(),
    openAudioPermissionSettings: vi.fn(),
    quitApp: vi.fn(),
    setContentProtected: vi.fn(),
    setSttLanguage: vi.fn(),
    sttModelDownload: vi.fn().mockResolvedValue(undefined),
    sttModelCancel: vi.fn().mockResolvedValue(undefined),
    sttModelRemove: vi.fn().mockResolvedValue(undefined),
  },
}));

const mocked = vi.mocked(commands);

const model = (overrides: Partial<ModelStatus>): ModelStatus => ({
  state: 'missing',
  downloaded: 0,
  total: 487_601_967,
  error: null,
  ...overrides,
});

async function openPage(name: string) {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name }));
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useModelStore.setState({ status: null, errorCode: null });
  useSettingsStore.setState({ sttLanguage: 'auto' });
  useShortcutStore.setState({ shortcuts: [] });
});

describe('idioma de la transcripción', () => {
  it('empieza en automático y al elegir uno se lo manda a Rust', async () => {
    mocked.setSttLanguage.mockResolvedValue({
      hideFromScreenShare: true,
      islandAnchor: 'center',
      freeOrigin: null,
      sttLanguage: 'es',
    });
    await openPage('Audio');

    const tabs = within(screen.getByRole('tablist', { name: 'Idioma de la transcripción' }));
    expect(tabs.getByRole('tab', { name: 'Automático' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(tabs.getByRole('tab', { name: 'ES' }));
    await act(async () => {});

    expect(mocked.setSttLanguage).toHaveBeenCalledWith('es');
    expect(tabs.getByRole('tab', { name: 'ES' })).toHaveAttribute('aria-selected', 'true');
    expect(tabs.getByRole('tab', { name: 'Automático' })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('modelo de voz', () => {
  it('sin descargar: muestra el tamaño y ofrece descargarlo', async () => {
    useModelStore.setState({ status: model({ state: 'missing' }) });
    await openPage('Audio');

    expect(screen.getByText('Sin descargar')).toBeInTheDocument();
    expect(screen.getByText('488 MB')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    expect(mocked.sttModelDownload).toHaveBeenCalledTimes(1);
  });

  it('descargando: muestra el progreso y permite cancelar', async () => {
    useModelStore.setState({
      status: model({ state: 'downloading', downloaded: 243_800_984 }),
    });
    await openPage('Audio');

    expect(screen.getByRole('progressbar', { name: 'Progreso de la descarga' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(screen.getByText(/50 %/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descargar' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mocked.sttModelCancel).toHaveBeenCalledTimes(1);
  });

  it('descargado: permite borrarlo', async () => {
    useModelStore.setState({ status: model({ state: 'ready', downloaded: 487_601_967 }) });
    await openPage('Audio');

    expect(screen.getByText('Descargado')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    expect(mocked.sttModelRemove).toHaveBeenCalledTimes(1);
  });

  it('un fallo de la descarga se explica con un mensaje claro', async () => {
    useModelStore.setState({ status: model({ state: 'missing', error: 'stt.model.network' }) });
    await openPage('Audio');

    expect(screen.getByRole('alert')).toHaveTextContent('Revisa tu conexión');
  });

  it('en inglés, los textos salen en inglés', async () => {
    useLocaleStore.setState({ locale: 'en' });
    useModelStore.setState({ status: model({ state: 'missing' }) });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    await act(async () => {});

    expect(screen.getByText('Not downloaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });
});

describe('atajos globales', () => {
  it('lista cada atajo con sus teclas', async () => {
    useShortcutStore.setState({
      shortcuts: [
        { action: 'toggleQuestion', keys: 'CommandOrControl+Shift+Space', registered: true },
        { action: 'toggleIsland', keys: 'CommandOrControl+Shift+H', registered: true },
      ],
    });
    await openPage('General');

    expect(screen.getByText('Grabar audio y responder')).toBeInTheDocument();
    expect(screen.getByText('Mostrar u ocultar la isla')).toBeInTheDocument();
    expect(screen.getAllByText('Shift')).toHaveLength(2);
    expect(screen.getByText('Space')).toBeInTheDocument();
    expect(screen.getByText('H')).toBeInTheDocument();
  });

  it('un atajo que otra app ya usa se marca como no disponible', async () => {
    useShortcutStore.setState({
      shortcuts: [
        { action: 'toggleQuestion', keys: 'CommandOrControl+Shift+Space', registered: false },
      ],
    });
    await openPage('General');

    expect(screen.getByText('En uso por otra app')).toBeInTheDocument();
    expect(screen.queryByText('Space')).not.toBeInTheDocument();
  });

  it('sin atajos no muestra la sección', async () => {
    await openPage('General');
    expect(screen.queryByText('Atajos')).not.toBeInTheDocument();
  });
});
