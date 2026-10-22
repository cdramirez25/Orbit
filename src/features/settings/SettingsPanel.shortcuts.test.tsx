import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { useShortcutStore } from '@/stores/shortcuts.store';
import type { ShortcutInfo } from '@/types';

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
    getAutostart: vi.fn().mockResolvedValue(false),
    setAutostart: vi.fn(),
    getShortcuts: vi.fn(),
    setShortcut: vi.fn(),
    resetShortcut: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const initial = (): ShortcutInfo[] => [
  {
    action: 'toggleQuestion',
    keys: 'CommandOrControl+Shift+Space',
    defaultKeys: 'CommandOrControl+Shift+Space',
    registered: true,
  },
  {
    action: 'toggleIsland',
    keys: 'CommandOrControl+Shift+H',
    defaultKeys: 'CommandOrControl+Shift+H',
    registered: true,
  },
];

async function openGeneral() {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'General' }));
  await act(async () => {});
}

const row = (text: string) => screen.getByText(text).closest('li') as HTMLElement;
const changeButton = (text: string) =>
  within(row(text)).getByRole('button', { name: /Cambiar|Cancelar/ });
/** En jsdom no hay Mac: Ctrl es la tecla principal. */
const press = (code: string, mods: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(window, { code, ...mods });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useShortcutStore.setState({ shortcuts: initial(), error: null });
  mocked.getAutostart.mockResolvedValue(false);
});

describe('atajos configurables', () => {
  it('Cambiar espera la nueva combinación y Esc la cancela sin cambiar nada', async () => {
    await openGeneral();
    fireEvent.click(changeButton('Mostrar u ocultar la isla'));

    expect(screen.getByText('Pulsa la nueva combinación…')).toBeInTheDocument();
    expect(screen.getByText(/Combina Cmd, Ctrl, Alt o Shift/)).toBeInTheDocument();

    press('Escape');
    expect(screen.queryByText('Pulsa la nueva combinación…')).not.toBeInTheDocument();
    expect(mocked.setShortcut).not.toHaveBeenCalled();
  });

  it('la combinación pulsada se manda a Rust y el atajo nuevo se ve en la lista', async () => {
    mocked.setShortcut.mockResolvedValue([
      initial()[0] as ShortcutInfo,
      { ...(initial()[1] as ShortcutInfo), keys: 'CommandOrControl+Alt+K' },
    ]);
    await openGeneral();
    fireEvent.click(changeButton('Mostrar u ocultar la isla'));

    press('KeyK', { ctrlKey: true, altKey: true });
    await act(async () => {});

    expect(mocked.setShortcut).toHaveBeenCalledWith('toggleIsland', 'CommandOrControl+Alt+K');
    expect(screen.queryByText('Pulsa la nueva combinación…')).not.toBeInTheDocument();
    const keys = within(row('Mostrar u ocultar la isla')).getAllByText(/^(Ctrl|Alt|K)$/);
    expect(keys.map((k) => k.textContent)).toEqual(['Ctrl', 'Alt', 'K']);
    // Como ya no es el de por defecto, aparece Restablecer.
    expect(
      within(row('Mostrar u ocultar la isla')).getByRole('button', { name: 'Restablecer' }),
    ).toBeInTheDocument();
  });

  it('pulsar solo una tecla modificadora no cambia nada: sigue esperando', async () => {
    await openGeneral();
    fireEvent.click(changeButton('Mostrar u ocultar la isla'));
    press('ControlLeft', { ctrlKey: true });
    press('ShiftLeft', { ctrlKey: true, shiftKey: true });

    expect(mocked.setShortcut).not.toHaveBeenCalled();
    expect(screen.getByText('Pulsa la nueva combinación…')).toBeInTheDocument();
  });

  it('un atajo que Rust rechaza explica por qué y deja el anterior', async () => {
    await openGeneral();
    const cases: Array<[string, string]> = [
      ['shortcut.needsModifier', 'Añade Cmd, Ctrl, Alt o Shift a la tecla.'],
      ['shortcut.duplicate', 'Otra acción de Orbit ya usa ese atajo.'],
      ['shortcut.unavailable', 'Otra app ya usa ese atajo. Prueba con otro.'],
      ['shortcut.invalid', 'Esa combinación no sirve. Prueba con otra.'],
      ['boom', 'No se pudo cambiar el atajo.'],
    ];
    for (const [code, message] of cases) {
      mocked.setShortcut.mockRejectedValueOnce({ code, message: 'x' });
      fireEvent.click(changeButton('Grabar audio y responder'));
      press('KeyK', { ctrlKey: true });
      await act(async () => {});
      expect(screen.getByRole('alert')).toHaveTextContent(message);
      const keys = within(row('Grabar audio y responder')).getAllByText(/^(Ctrl|Shift|Space)$/);
      expect(keys.map((k) => k.textContent)).toEqual(['Ctrl', 'Shift', 'Space']);
    }
  });

  it('el error de un atajo se quita al volver a intentarlo', async () => {
    mocked.setShortcut.mockRejectedValueOnce({ code: 'shortcut.duplicate', message: 'x' });
    await openGeneral();
    fireEvent.click(changeButton('Grabar audio y responder'));
    press('KeyH', { ctrlKey: true, shiftKey: true });
    await act(async () => {});
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(changeButton('Grabar audio y responder'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mientras espera, la combinación no llega a la página (Cmd+W no cierra la ventana)', async () => {
    await openGeneral();
    fireEvent.click(changeButton('Mostrar u ocultar la isla'));
    const notPrevented = press('KeyW', { ctrlKey: true });
    expect(notPrevented).toBe(false);
  });

  it('fuera de la captura, pulsar teclas no toca los atajos', async () => {
    await openGeneral();
    press('KeyK', { ctrlKey: true });
    expect(mocked.setShortcut).not.toHaveBeenCalled();
  });

  it('Restablecer devuelve el de por defecto y solo aparece en los que se cambiaron', async () => {
    useShortcutStore.setState({
      shortcuts: [
        { ...(initial()[0] as ShortcutInfo), keys: 'Alt+Q' },
        initial()[1] as ShortcutInfo,
      ],
    });
    mocked.resetShortcut.mockResolvedValue(initial());
    await openGeneral();

    expect(screen.getAllByRole('button', { name: 'Restablecer' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    await act(async () => {});

    expect(mocked.resetShortcut).toHaveBeenCalledWith('toggleQuestion');
    expect(screen.queryByRole('button', { name: 'Restablecer' })).not.toBeInTheDocument();
  });

  it('un atajo que otra app ya tenía sigue pudiéndose cambiar', async () => {
    useShortcutStore.setState({
      shortcuts: [
        { ...(initial()[0] as ShortcutInfo), registered: false },
        initial()[1] as ShortcutInfo,
      ],
    });
    await openGeneral();
    expect(screen.getByText('En uso por otra app')).toBeInTheDocument();
    expect(changeButton('Grabar audio y responder')).toBeInTheDocument();
  });
});
