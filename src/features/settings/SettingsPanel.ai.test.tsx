import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AI_PROVIDERS } from '@/features/settings/ai/providers';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';

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
    getIslandSettings: vi.fn(),
  },
}));

function openAi() {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'IA' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
});

describe('página de IA de los ajustes', () => {
  it('explica que las claves se quedan en el equipo y que todavía es solo el diseño', () => {
    openAi();
    expect(screen.getByText(/se guardarán solo en este equipo/)).toBeInTheDocument();
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
  });

  it('ofrece los cuatro proveedores', () => {
    openAi();
    const tabs = screen.getByRole('tablist', { name: 'Proveedores de IA' });
    for (const { name } of AI_PROVIDERS) {
      expect(tabs).toHaveTextContent(name);
    }
    expect(AI_PROVIDERS.map((p) => p.name)).toEqual(['Claude', 'ChatGPT', 'Ollama', 'Docker']);
  });

  it('un proveedor en la nube pide clave de API y uno local pide la dirección', () => {
    openAi();
    expect(screen.getByRole('tab', { name: 'Claude' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Clave de API')).toBeInTheDocument();
    expect(screen.queryByLabelText('Dirección del servidor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Ollama' }));
    expect(screen.getByLabelText('Dirección del servidor')).toBeInTheDocument();
    expect(screen.queryByLabelText('Clave de API')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Modelo')).toBeInTheDocument();
  });

  it('la clave se escribe oculta', () => {
    openAi();
    expect(screen.getByLabelText('Clave de API')).toHaveAttribute('type', 'password');
  });

  it('todavía no guarda nada: los campos y los botones están deshabilitados', () => {
    openAi();
    for (const { name } of AI_PROVIDERS) {
      fireEvent.click(screen.getByRole('tab', { name }));
      for (const field of screen.getAllByRole('textbox', { hidden: false })) {
        expect(field).toBeDisabled();
      }
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Probar conexión' })).toBeDisabled();
      expect(screen.getByLabelText('Modelo')).toBeDisabled();
    }
  });

  it('no llama a ningún comando de Rust al abrirla ni al cambiar de proveedor', () => {
    openAi();
    fireEvent.click(screen.getByRole('tab', { name: 'Docker' }));
    expect(vi.mocked(commands.quitApp)).not.toHaveBeenCalled();
  });

  it('se traduce al inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'AI' }));
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    expect(screen.getByText(/stored only on this computer/)).toBeInTheDocument();
  });
});
