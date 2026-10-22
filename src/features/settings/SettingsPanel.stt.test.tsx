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
    sttModelChooseDir: vi.fn(),
    sttModelResetDir: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const model = (overrides: Partial<ModelStatus>): ModelStatus =>
  ({
    state: 'missing',
    downloaded: 0,
    total: 487_601_967,
    error: null,
    dir: '/Users/yo/Library/Application Support/dev.orbit.island/models',
    customDir: false,
    ...overrides,
  }) as ModelStatus;

const QUESTION = {
  action: 'toggleQuestion',
  keys: 'CommandOrControl+Shift+Space',
  defaultKeys: 'CommandOrControl+Shift+Space',
} as const;
const ISLAND = {
  action: 'toggleIsland',
  keys: 'CommandOrControl+Shift+H',
  defaultKeys: 'CommandOrControl+Shift+H',
} as const;

async function openPage(name: string) {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name }));
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useModelStore.setState({ status: null, errorCode: null, movingDir: false });
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
      onboardingDone: true,
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

describe('carpeta del modelo', () => {
  it('muestra dónde está el modelo y deja elegir otra carpeta con el selector del sistema', async () => {
    useModelStore.setState({ status: model({ state: 'ready', downloaded: 487_601_967 }) });
    mocked.sttModelChooseDir.mockResolvedValue(
      model({ state: 'ready', downloaded: 487_601_967, dir: '/Volumes/Externo', customDir: true }),
    );
    await openPage('Audio');

    expect(screen.getByText(/dev\.orbit\.island\/models/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usar la carpeta de Orbit' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar carpeta' }));
    await act(async () => {});

    expect(mocked.sttModelChooseDir).toHaveBeenCalledWith('Elige dónde guardar el modelo de voz');
    expect(screen.getByText('/Volumes/Externo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar la carpeta de Orbit' })).toBeInTheDocument();
  });

  it('si se cancela el selector, no cambia nada', async () => {
    useModelStore.setState({ status: model({ state: 'ready' }) });
    mocked.sttModelChooseDir.mockResolvedValue(null);
    await openPage('Audio');

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar carpeta' }));
    await act(async () => {});

    expect(screen.getByText(/dev\.orbit\.island\/models/)).toBeInTheDocument();
  });

  it('con una carpeta propia, Usar la carpeta de Orbit la devuelve a la de la app', async () => {
    useModelStore.setState({
      status: model({ state: 'ready', dir: '/Volumes/Externo', customDir: true }),
    });
    mocked.sttModelResetDir.mockResolvedValue(model({ state: 'ready' }));
    await openPage('Audio');

    fireEvent.click(screen.getByRole('button', { name: 'Usar la carpeta de Orbit' }));
    await act(async () => {});

    expect(mocked.sttModelResetDir).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Usar la carpeta de Orbit' })).toBeNull();
  });

  it('mientras se descarga no se puede cambiar de carpeta', async () => {
    useModelStore.setState({ status: model({ state: 'downloading', downloaded: 1000 }) });
    await openPage('Audio');
    expect(screen.getByRole('button', { name: 'Cambiar carpeta' })).toBeDisabled();
  });

  it('mientras se mueve el modelo avisa y bloquea los botones', async () => {
    useModelStore.setState({ status: model({ state: 'ready' }), movingDir: true });
    await openPage('Audio');
    expect(screen.getByRole('button', { name: 'Moviendo…' })).toBeDisabled();
  });

  it('un fallo al mover (sin permiso en el disco) se explica', async () => {
    useModelStore.setState({ status: model({ state: 'ready' }) });
    mocked.sttModelChooseDir.mockRejectedValue({ code: 'stt.model.disk', message: 'x' });
    await openPage('Audio');

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar carpeta' }));
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar el modelo en el disco');
  });
});

describe('atajos globales', () => {
  it('lista cada atajo con sus teclas', async () => {
    useShortcutStore.setState({
      shortcuts: [
        { ...QUESTION, registered: true },
        { ...ISLAND, registered: true },
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
      shortcuts: [{ ...QUESTION, registered: false }],
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
