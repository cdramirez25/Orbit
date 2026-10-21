import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { remote } from '@/ipc/remote';
import { useControlStore } from '@/stores/control.store';

vi.mock('@/ipc/remote', () => ({
  remote: {
    sendCommand: vi.fn().mockResolvedValue(undefined),
    onState: vi.fn().mockResolvedValue(() => {}),
    requestState: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/ipc/commands', () => ({
  commands: {
    getAudioPermission: vi.fn().mockResolvedValue('notRequired'),
    requestAudioPermission: vi.fn(),
    openAudioPermissionSettings: vi.fn(),
    quitApp: vi.fn(),
    setContentProtected: vi.fn(),
    getIslandSettings: vi.fn(),
  },
}));

const sent = vi.mocked(remote.sendCommand);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useControlStore.setState({ islandState: 'compact', style: 'floating', anchor: 'center' });
});

describe('ventana de ajustes', () => {
  it('agrupa los controles por secciones con su título', () => {
    render(<SettingsPanel />);
    for (const title of ['Comportamiento', 'Apariencia', 'Idioma', 'Privacidad', 'Aplicación']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('main', { name: 'Ajustes' })).toBeInTheDocument();
  });

  it('marca lo que la isla tiene ahora (estado, posición y estilo)', () => {
    render(<SettingsPanel />);
    expect(screen.getByRole('tab', { name: 'Compacto' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Centro' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Flotante' })).toHaveAttribute('aria-selected', 'true');
  });

  it('refleja al instante un cambio del espejo de la isla', () => {
    render(<SettingsPanel />);
    act(() => useControlStore.setState({ islandState: 'expanded', anchor: 'left' }));
    expect(screen.getByRole('tab', { name: 'Expandido' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Izquierda' })).toHaveAttribute('aria-selected', 'true');
  });

  it('cada botón manda su orden a la isla', () => {
    render(<SettingsPanel />);

    fireEvent.click(screen.getByRole('tab', { name: 'Expandido' }));
    expect(sent).toHaveBeenLastCalledWith({ type: 'goTo', state: 'expanded' });

    fireEvent.click(screen.getByRole('tab', { name: 'Alerta' }));
    expect(sent).toHaveBeenLastCalledWith({ type: 'alert' });

    fireEvent.click(screen.getByRole('button', { name: 'Simular respuesta' }));
    expect(sent).toHaveBeenLastCalledWith({ type: 'simulate' });

    fireEvent.click(screen.getByRole('tab', { name: 'Derecha' }));
    expect(sent).toHaveBeenLastCalledWith({ type: 'setAnchor', anchor: 'right' });

    fireEvent.click(screen.getByRole('tab', { name: 'Pegada' }));
    expect(sent).toHaveBeenLastCalledWith({ type: 'setStyle', style: 'attached' });
  });

  it('cambiar de idioma lo aplica aquí y se lo manda a la isla', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('tab', { name: 'EN' }));

    expect(useLocaleStore.getState().locale).toBe('en');
    expect(sent).toHaveBeenLastCalledWith({ type: 'setLocale', locale: 'en' });
    expect(screen.getByRole('heading', { name: 'Behavior' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simulate answer' })).toBeInTheDocument();
  });

  it('explica qué hace "ocultar al compartir pantalla"', () => {
    render(<SettingsPanel />);
    expect(screen.getByRole('switch', { name: /Ocultar la isla/ })).toBeInTheDocument();
    expect(screen.getByText(/no se ve cuando compartes pantalla/)).toBeInTheDocument();
  });

  it('Salir cierra Orbit', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(commands.quitApp).toHaveBeenCalledTimes(1);
  });
});
