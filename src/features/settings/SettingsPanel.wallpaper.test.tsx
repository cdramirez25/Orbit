import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { useWallpaperStore } from '@/stores/wallpaper.store';
import type { WallpaperItem, WallpaperStatus } from '@/types';

vi.mock('@/ipc/remote', () => ({
  remote: {
    sendCommand: vi.fn(),
    onState: vi.fn().mockResolvedValue(() => {}),
    requestState: vi.fn(),
  },
}));

vi.mock('@/ipc/commands', () => ({
  commands: {
    quitApp: vi.fn(),
    setContentProtected: vi.fn(),
    wallpaperStatus: vi.fn(),
    wallpaperList: vi.fn(),
    wallpaperSelect: vi.fn(),
    wallpaperSetEnabled: vi.fn(),
    wallpaperSetPaused: vi.fn(),
    wallpaperSetPerformance: vi.fn(),
    wallpaperOpenFolder: vi.fn(),
    wallpaperAddFiles: vi.fn(),
    fileUrl: vi.fn((path: string) => `asset://${path}`),
    currentWindowLabel: vi.fn(() => null),
  },
}));

const mocked = vi.mocked(commands);

const status = (overrides: Partial<WallpaperStatus> = {}): WallpaperStatus => ({
  enabled: false,
  file: null,
  kind: null,
  path: null,
  manualPause: false,
  performance: 'any',
  screenPaused: [],
  missing: false,
  folder: '/Users/yo/Pictures/Orbit/Wallpapers',
  error: null,
  ...overrides,
});

const ITEMS: WallpaperItem[] = [
  { file: 'atardecer.png', kind: 'image', size: 1, path: '/w/atardecer.png' },
  { file: 'olas.mp4', kind: 'video', size: 2, path: '/w/olas.mp4' },
];

const playing = (): WallpaperStatus =>
  status({
    enabled: true,
    file: 'olas.mp4',
    kind: 'video',
    path: '/w/olas.mp4',
    screenPaused: [false],
  });

async function openPage(current: WallpaperStatus = status(), items = ITEMS) {
  mocked.wallpaperList.mockResolvedValue(items);
  useWallpaperStore.setState({ status: current });
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Fondo' }));
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useWallpaperStore.setState({
    status: null,
    url: null,
    screen: 0,
    items: [],
    errorCode: null,
    adding: false,
  });
  mocked.fileUrl.mockImplementation((path) => `asset://${path}`);
  mocked.wallpaperSelect.mockResolvedValue(playing());
  mocked.wallpaperSetEnabled.mockResolvedValue(status());
  mocked.wallpaperSetPaused.mockResolvedValue(status({ manualPause: true }));
  mocked.wallpaperSetPerformance.mockResolvedValue(status({ performance: 'large' }));
  mocked.wallpaperOpenFolder.mockResolvedValue();
  mocked.wallpaperAddFiles.mockResolvedValue(ITEMS);
});

describe('página del fondo de pantalla', () => {
  it('la barra de ajustes tiene la sección Fondo', () => {
    render(<SettingsPanel />);
    expect(screen.getByRole('button', { name: 'Fondo' })).toBeInTheDocument();
  });

  it('lee la carpeta al abrirse y enseña cada archivo con su tipo', async () => {
    await openPage();

    expect(mocked.wallpaperList).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Usar atardecer.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar olas.mp4' })).toBeInTheDocument();
    expect(screen.getByText('/Users/yo/Pictures/Orbit/Wallpapers')).toBeInTheDocument();
  });

  it('también la vuelve a leer cuando se vuelve a la ventana (por si se pusieron archivos)', async () => {
    await openPage();
    mocked.wallpaperList.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(mocked.wallpaperList).toHaveBeenCalledTimes(1);
  });

  it('elegir un archivo lo usa como fondo y lo marca', async () => {
    await openPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Usar olas.mp4' }));
    });

    expect(mocked.wallpaperSelect).toHaveBeenCalledWith('olas.mp4');
    expect(screen.getByRole('button', { name: 'Usar olas.mp4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Usar atardecer.png' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Activo');
  });

  it('sin fondo elegido no se puede encender; con uno sí, y se apaga', async () => {
    await openPage();
    expect(screen.getByRole('switch', { name: 'Mostrar el fondo de pantalla' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Apagado');
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeDisabled();
  });

  it('con un fondo en marcha, pausar y reanudar van a mano', async () => {
    mocked.wallpaperSetPaused.mockResolvedValue({ ...playing(), manualPause: true });
    await openPage(playing());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    });
    expect(mocked.wallpaperSetPaused).toHaveBeenCalledWith(true);
    expect(screen.getByRole('status')).toHaveTextContent('En pausa');
    expect(screen.getByRole('button', { name: 'Reanudar' })).toBeInTheDocument();

    mocked.wallpaperSetPaused.mockResolvedValue(playing());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reanudar' }));
    });
    expect(mocked.wallpaperSetPaused).toHaveBeenLastCalledWith(false);
  });

  it('apagar el fondo lo manda a Rust', async () => {
    await openPage(playing());
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Mostrar el fondo de pantalla' }));
    });
    expect(mocked.wallpaperSetEnabled).toHaveBeenCalledWith(false);
    expect(screen.getByRole('status')).toHaveTextContent('Apagado');
  });

  it('el modo rendimiento ofrece sus tres opciones y se cambia', async () => {
    await openPage(playing());
    const select = screen.getByRole('combobox');

    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Pausar con cualquier ventana abierta',
      'Pausar con ventanas grandes o a pantalla completa',
      'Nunca pausar solo',
    ]);
    expect(select).toHaveValue('any');

    await act(async () => {
      fireEvent.change(select, { target: { value: 'large' } });
    });
    expect(mocked.wallpaperSetPerformance).toHaveBeenCalledWith('large');
    expect(select).toHaveValue('large');
  });

  it('si el modo rendimiento lo pausó, lo dice', async () => {
    await openPage({ ...playing(), screenPaused: [true] });
    expect(screen.getByRole('status')).toHaveTextContent('En pausa por rendimiento');
  });

  it('avisa que los videos siempre van sin sonido', async () => {
    await openPage(playing());
    expect(screen.getByText(/Los videos siempre van sin sonido/)).toBeInTheDocument();
  });

  it('con la carpeta vacía explica qué poner y dónde', async () => {
    await openPage(status(), []);
    expect(screen.getByText(/Todavía no hay fondos/)).toBeInTheDocument();
    expect(screen.getByText(/JPG, PNG, WebP/)).toBeInTheDocument();
  });

  it('abre la carpeta, añade archivos con el selector y actualiza la lista', async () => {
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir carpeta' }));
    expect(mocked.wallpaperOpenFolder).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Añadir archivos' }));
    });
    expect(mocked.wallpaperAddFiles).toHaveBeenCalledWith('Elige imágenes o videos');

    mocked.wallpaperList.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    });
    expect(mocked.wallpaperList).toHaveBeenCalledTimes(1);
  });

  it('si el archivo elegido ya no está lo avisa', async () => {
    await openPage(status({ enabled: true, file: 'borrado.mp4', missing: true }));
    expect(screen.getByRole('alert')).toHaveTextContent('El fondo elegido ya no está');
  });

  it('un fallo al mostrar el fondo o al copiar se explica', async () => {
    await openPage(status({ error: 'wallpaper.surface' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo mostrar el fondo');

    useWallpaperStore.setState({ status: status(), errorCode: 'wallpaper.copy' });
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo copiar un archivo');
  });

  it('en inglés, los textos salen en inglés', async () => {
    useLocaleStore.setState({ locale: 'en' });
    mocked.wallpaperList.mockResolvedValue(ITEMS);
    useWallpaperStore.setState({ status: playing() });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Wallpaper' }));
    await act(async () => {});

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use olas.mp4' })).toBeInTheDocument();
    expect(
      screen.getByText('Videos always play without sound.', { exact: false }),
    ).toBeInTheDocument();
  });
});
