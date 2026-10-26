import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { useWallpaperStore } from '@/stores/wallpaper.store';
import type { WallpaperItem, WallpaperScreen, WallpaperStatus } from '@/types';

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
    wallpaperSetSound: vi.fn(),
    wallpaperSetVolume: vi.fn(),
    wallpaperSetPerScreen: vi.fn(),
    wallpaperSetEnabled: vi.fn(),
    wallpaperSetPaused: vi.fn(),
    wallpaperSetPerformance: vi.fn(),
    wallpaperOpenFolder: vi.fn(),
    wallpaperAddFiles: vi.fn(),
    soundOutputList: vi.fn().mockResolvedValue([]),
    soundOutputSet: vi.fn(),
    fileUrl: vi.fn((path: string) => `asset://${path}`),
    currentWindowLabel: vi.fn(() => null),
  },
}));

const mocked = vi.mocked(commands);

const NO_FILE = { file: null, kind: null, path: null, hasAudio: null } as const;

const screenOf = (overrides: Partial<WallpaperScreen> = {}): WallpaperScreen => ({
  key: 'Pantalla A',
  label: 'Pantalla A',
  ...NO_FILE,
  sound: false,
  audible: false,
  missing: false,
  paused: false,
  ...overrides,
});

const OLAS = { file: 'olas.mp4', kind: 'video', path: '/w/olas.mp4', hasAudio: true } as const;
const LLUVIA = {
  file: 'lluvia.mp4',
  kind: 'video',
  path: '/w/lluvia.mp4',
  hasAudio: false,
} as const;
const ATARDECER = {
  file: 'atardecer.png',
  kind: 'image',
  path: '/w/atardecer.png',
  hasAudio: null,
} as const;

const status = (overrides: Partial<WallpaperStatus> = {}): WallpaperStatus => ({
  enabled: false,
  file: null,
  sound: false,
  volume: 60,
  manualPause: false,
  performance: 'any',
  perScreen: false,
  screens: [screenOf()],
  folder: '/Users/yo/Pictures/Orbit/Wallpapers',
  error: null,
  ...overrides,
});

const ITEMS: WallpaperItem[] = [
  { file: 'atardecer.png', kind: 'image', size: 1, path: '/w/atardecer.png', hasAudio: null },
  { file: 'olas.mp4', kind: 'video', size: 2, path: '/w/olas.mp4', hasAudio: true },
  { file: 'lluvia.mp4', kind: 'video', size: 3, path: '/w/lluvia.mp4', hasAudio: false },
];

const playing = (overrides: Partial<WallpaperScreen> = {}): WallpaperStatus =>
  status({
    enabled: true,
    file: 'olas.mp4',
    screens: [screenOf({ ...OLAS, ...overrides })],
  });

/** Dos monitores. */
const twoScreens = (
  first: Partial<WallpaperScreen>,
  second: Partial<WallpaperScreen>,
  overrides: Partial<WallpaperStatus> = {},
): WallpaperStatus =>
  status({
    enabled: true,
    file: 'olas.mp4',
    screens: [
      screenOf({ key: 'Pantalla A', ...OLAS, ...first }),
      screenOf({ key: 'Pantalla B', label: 'Pantalla B', ...OLAS, ...second }),
    ],
    ...overrides,
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

    expect(mocked.wallpaperSelect).toHaveBeenCalledWith('olas.mp4', null);
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
    const select = screen.getByRole('combobox', { name: /Modo rendimiento/ });

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
    await openPage(playing({ paused: true }));
    expect(screen.getByRole('status')).toHaveTextContent('En pausa por rendimiento');
  });

  it('si el sistema no da nombre al monitor, se numera', async () => {
    await openPage(twoScreens({ label: null }, { label: null }, { perScreen: true }));
    expect(screen.getByRole('tab', { name: 'Monitor 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Monitor 2' })).toBeInTheDocument();
  });

  it('con un solo monitor no ofrece repartir el fondo entre monitores', async () => {
    await openPage(playing());
    expect(screen.queryByText('Monitores')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'El mismo fondo en todos' })).not.toBeInTheDocument();
  });

  it('marca con un icono los videos que traen audio', async () => {
    await openPage(playing());
    const olas = screen.getByRole('button', { name: 'Usar olas.mp4' });
    expect(within(olas).getByLabelText('Con audio')).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: 'Usar lluvia.mp4' })).queryByLabelText('Con audio'),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: 'Usar atardecer.png' })).queryByLabelText(
        'Con audio',
      ),
    ).not.toBeInTheDocument();
  });

  // ── sonido ─────────────────────────────────────────────────────────────────────────────────

  it('con un video con audio, el sonido empieza apagado y se puede activar', async () => {
    mocked.wallpaperSetSound.mockResolvedValue(playing({ sound: true, audible: true }));
    await openPage(playing());
    const toggle = screen.getByRole('switch', { name: 'Activar el sonido del video' });

    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('slider', { name: 'Volumen del video' })).toBeDisabled();
    expect(screen.getByText(/Los videos van sin sonido hasta que lo actives/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(mocked.wallpaperSetSound).toHaveBeenCalledWith(true, null);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('slider', { name: 'Volumen del video' })).toBeEnabled();
  });

  it('un video sin pista de audio no deja activar el sonido y lo explica', async () => {
    await openPage(playing({ ...LLUVIA }));

    expect(screen.getByRole('switch', { name: 'Activar el sonido del video' })).toBeDisabled();
    expect(screen.getByText(/no tiene pista de audio/)).toBeInTheDocument();
  });

  it('con una imagen o sin nada elegido, pide elegir un video', async () => {
    await openPage(playing({ ...ATARDECER }));
    expect(screen.getByRole('switch', { name: 'Activar el sonido del video' })).toBeDisabled();
    expect(screen.getByText('Elige un video para poder activar el sonido.')).toBeInTheDocument();
  });

  it('si no se pudo comprobar el audio del video, deja probar y lo dice', async () => {
    await openPage(playing({ hasAudio: null }));
    expect(screen.getByRole('switch', { name: 'Activar el sonido del video' })).toBeEnabled();
    expect(screen.getByText('No se pudo comprobar si este video tiene audio.')).toBeInTheDocument();
  });

  it('el volumen se nota al instante y se manda a Rust cuando deja de moverse', async () => {
    vi.useFakeTimers();
    try {
      mocked.wallpaperSetVolume.mockResolvedValue({
        ...playing({ sound: true, audible: true }),
        volume: 30,
      });
      useLocaleStore.setState({ locale: 'es' });
      mocked.wallpaperList.mockResolvedValue(ITEMS);
      useWallpaperStore.setState({
        status: { ...playing({ sound: true, audible: true }), sound: true },
      });
      render(<SettingsPanel />);
      fireEvent.click(screen.getByRole('button', { name: 'Fondo' }));
      await act(async () => {});
      const slider = screen.getByRole('slider', { name: 'Volumen del video' });

      fireEvent.change(slider, { target: { value: '20' } });
      fireEvent.change(slider, { target: { value: '30' } });
      expect(slider).toHaveValue('30');
      expect(screen.getByText('30%')).toBeInTheDocument();
      // Mientras se mueve no se manda nada.
      expect(mocked.wallpaperSetVolume).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(mocked.wallpaperSetVolume).toHaveBeenCalledTimes(1);
      expect(mocked.wallpaperSetVolume).toHaveBeenCalledWith(30);
      expect(slider).toHaveValue('30');
    } finally {
      vi.useRealTimers();
    }
  });

  // ── monitores ──────────────────────────────────────────────────────────────────────────────

  it('con dos monitores ofrece el mismo fondo en todos o uno distinto en cada uno', async () => {
    mocked.wallpaperSetPerScreen.mockResolvedValue(twoScreens({}, {}, { perScreen: true }));
    await openPage(twoScreens({}, {}));

    const same = screen.getByRole('tab', { name: 'El mismo fondo en todos' });
    const each = screen.getByRole('tab', { name: 'Uno distinto en cada monitor' });
    expect(same).toHaveAttribute('aria-selected', 'true');
    expect(each).toHaveAttribute('aria-selected', 'false');
    // Con el mismo fondo en todos no hace falta elegir monitor.
    expect(screen.queryByRole('tab', { name: 'Pantalla B' })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(each);
    });

    expect(mocked.wallpaperSetPerScreen).toHaveBeenCalledWith(true);
    expect(screen.getByRole('tab', { name: 'Uno distinto en cada monitor' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Pantalla A' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pantalla B' })).toBeInTheDocument();
  });

  it('con un fondo por monitor, elegir un archivo es para el monitor elegido', async () => {
    const split = twoScreens({}, { ...ATARDECER }, { perScreen: true });
    mocked.wallpaperSelect.mockResolvedValue(split);
    await openPage(split);

    // Primero se ve lo del primer monitor.
    expect(screen.getByRole('button', { name: 'Usar olas.mp4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Pantalla B' }));
    });
    // Ahora se ve lo del segundo.
    expect(screen.getByRole('button', { name: 'Usar atardecer.png' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Usar olas.mp4' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Usar lluvia.mp4' }));
    });
    expect(mocked.wallpaperSelect).toHaveBeenCalledWith('lluvia.mp4', 'Pantalla B');
  });

  it('con un fondo por monitor, el sonido es del monitor elegido', async () => {
    const split = twoScreens({}, { ...LLUVIA }, { perScreen: true });
    mocked.wallpaperSetSound.mockResolvedValue(split);
    await openPage(split);

    // El primero tiene un video con audio: se puede activar, y es solo para él.
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Activar el sonido del video' }));
    });
    expect(mocked.wallpaperSetSound).toHaveBeenCalledWith(true, 'Pantalla A');

    // El segundo tiene un video sin audio: no se puede.
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Pantalla B' }));
    });
    expect(screen.getByRole('switch', { name: 'Activar el sonido del video' })).toBeDisabled();
    expect(screen.getByText(/no tiene pista de audio/)).toBeInTheDocument();
  });

  it('con una sola pantalla conectada pero un fondo por monitor guardado, deja volver al mismo para todos', async () => {
    await openPage({ ...playing(), perScreen: true });
    expect(screen.getByRole('tab', { name: 'El mismo fondo en todos' })).toBeInTheDocument();
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
    await openPage(
      status({
        enabled: true,
        file: 'borrado.mp4',
        screens: [screenOf({ file: 'borrado.mp4', missing: true })],
      }),
    );
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
    expect(screen.getByRole('switch', { name: 'Turn the video sound on' })).toBeInTheDocument();
    expect(screen.getByText('Sound')).toBeInTheDocument();
  });
});
