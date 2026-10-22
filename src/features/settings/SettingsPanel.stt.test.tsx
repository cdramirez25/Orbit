import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { useModelStore } from '@/stores/model.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useShortcutStore } from '@/stores/shortcuts.store';
import { modelStatus } from '@/test/factories';

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
    sttModelUse: vi.fn(),
    sttModelChooseDir: vi.fn(),
    sttModelResetDir: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

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

const row = (name: string) => within(screen.getByRole('listitem', { name }));

describe('modelo de voz', () => {
  it('ofrece los cuatro modelos con su tamaño y recomienda small', async () => {
    useModelStore.setState({ status: modelStatus() });
    await openPage('Audio');

    const names = screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'));
    expect(names).toEqual(['Base', 'Small', 'Medium', 'Turbo']);
    expect(row('Base').getByText(/148 MB/)).toBeInTheDocument();
    expect(row('Small').getByText(/488 MB/)).toBeInTheDocument();
    expect(row('Medium').getByText(/1\.5 GB/)).toBeInTheDocument();
    expect(row('Turbo').getByText(/574 MB/)).toBeInTheDocument();
    expect(row('Small').getByText('Recomendado')).toBeInTheDocument();
    expect(row('Base').queryByText('Recomendado')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Borrar/ })).not.toBeInTheDocument();
  });

  it('sin descargar: cada modelo se descarga por separado', async () => {
    useModelStore.setState({ status: modelStatus() });
    await openPage('Audio');

    fireEvent.click(screen.getByRole('button', { name: 'Descargar Medium' }));
    expect(mocked.sttModelDownload).toHaveBeenCalledTimes(1);
    expect(mocked.sttModelDownload).toHaveBeenCalledWith('medium');
  });

  it('descargando: muestra el progreso de ese modelo, permite cancelar y bloquea los demás', async () => {
    useModelStore.setState({
      status: modelStatus({
        entries: { medium: { state: 'downloading', downloaded: 766_881_530 } },
      }),
    });
    await openPage('Audio');

    expect(
      screen.getByRole('progressbar', { name: 'Progreso de la descarga Medium' }),
    ).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText(/50 %/)).toBeInTheDocument();
    // Se baja de uno en uno: los demás no se pueden empezar.
    expect(screen.getByRole('button', { name: 'Descargar Base' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descargar Turbo' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Descargar Medium' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar Medium' }));
    expect(mocked.sttModelCancel).toHaveBeenCalledTimes(1);
  });

  it('el modelo en uso se marca, no ofrece usarlo y se puede borrar', async () => {
    useModelStore.setState({ status: modelStatus({ entries: { small: { state: 'ready' } } }) });
    await openPage('Audio');

    expect(row('Small').getByText('En uso')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usar Small' })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Borrar Small' }));
    expect(mocked.sttModelRemove).toHaveBeenCalledWith('small');
  });

  it('un modelo descargado que no es el que se usa se puede elegir', async () => {
    useModelStore.setState({
      status: modelStatus({
        entries: { small: { state: 'ready' }, base: { state: 'ready' } },
      }),
    });
    mocked.sttModelUse.mockResolvedValue(
      modelStatus({
        active: 'base',
        entries: { small: { state: 'ready' }, base: { state: 'ready' } },
      }),
    );
    await openPage('Audio');

    expect(row('Base').getByText('Descargado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Usar Base' }));
    await act(async () => {});

    expect(mocked.sttModelUse).toHaveBeenCalledWith('base');
    expect(row('Base').getByText('En uso')).toBeInTheDocument();
    expect(row('Small').getByText('Descargado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar Small' })).toBeInTheDocument();
  });

  it('un fallo de la descarga se explica en el modelo que falló', async () => {
    useModelStore.setState({
      status: modelStatus({ entries: { turbo: { error: 'stt.model.network' } } }),
    });
    await openPage('Audio');

    expect(row('Turbo').getByRole('alert')).toHaveTextContent('Revisa tu conexión');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('una orden rechazada (modelo sin descargar) muestra su aviso', async () => {
    useModelStore.setState({ status: modelStatus(), errorCode: 'stt.model.notReady' });
    await openPage('Audio');

    expect(screen.getByRole('alert')).toHaveTextContent('Ese modelo todavía no está descargado');
  });

  it('en inglés, los textos salen en inglés', async () => {
    useLocaleStore.setState({ locale: 'en' });
    useModelStore.setState({ status: modelStatus({ entries: { small: { state: 'ready' } } }) });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    await act(async () => {});

    expect(screen.getByText('In use')).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Base' })).toBeInTheDocument();
  });
});

describe('carpeta de los modelos', () => {
  const ready = { entries: { small: { state: 'ready' as const } } };

  it('muestra dónde están los modelos y deja elegir otra carpeta con el selector del sistema', async () => {
    useModelStore.setState({ status: modelStatus(ready) });
    mocked.sttModelChooseDir.mockResolvedValue(
      modelStatus({ ...ready, dir: '/Volumes/Externo', customDir: true }),
    );
    await openPage('Audio');

    expect(screen.getByText(/dev\.orbit\.island\/models/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usar la carpeta de Orbit' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar carpeta' }));
    await act(async () => {});

    expect(mocked.sttModelChooseDir).toHaveBeenCalledWith('Elige dónde guardar los modelos de voz');
    expect(screen.getByText('/Volumes/Externo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar la carpeta de Orbit' })).toBeInTheDocument();
  });

  it('si se cancela el selector, no cambia nada', async () => {
    useModelStore.setState({ status: modelStatus(ready) });
    mocked.sttModelChooseDir.mockResolvedValue(null);
    await openPage('Audio');

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar carpeta' }));
    await act(async () => {});

    expect(screen.getByText(/dev\.orbit\.island\/models/)).toBeInTheDocument();
  });

  it('con una carpeta propia, Usar la carpeta de Orbit la devuelve a la de la app', async () => {
    useModelStore.setState({
      status: modelStatus({ ...ready, dir: '/Volumes/Externo', customDir: true }),
    });
    mocked.sttModelResetDir.mockResolvedValue(modelStatus(ready));
    await openPage('Audio');

    fireEvent.click(screen.getByRole('button', { name: 'Usar la carpeta de Orbit' }));
    await act(async () => {});

    expect(mocked.sttModelResetDir).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Usar la carpeta de Orbit' })).toBeNull();
  });

  it('mientras se descarga no se puede cambiar de carpeta', async () => {
    useModelStore.setState({
      status: modelStatus({ entries: { small: { state: 'downloading', downloaded: 1000 } } }),
    });
    await openPage('Audio');
    expect(screen.getByRole('button', { name: 'Cambiar carpeta' })).toBeDisabled();
  });

  it('mientras se mueven los modelos avisa y bloquea los botones', async () => {
    useModelStore.setState({ status: modelStatus(ready), movingDir: true });
    await openPage('Audio');
    expect(screen.getByRole('button', { name: 'Moviendo…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Borrar Small' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descargar Base' })).toBeDisabled();
  });

  it('un fallo al mover (sin permiso en el disco) se explica', async () => {
    useModelStore.setState({ status: modelStatus(ready) });
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
