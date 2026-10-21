import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { useAiStore } from '@/stores/ai.store';
import type { AiProviderId, AiSaveInput, AiStatus } from '@/types';

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
    aiGetStatus: vi.fn(),
    aiSaveProvider: vi.fn(),
    aiSetActive: vi.fn(),
    aiTestProvider: vi.fn(),
    aiListModels: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const IDS: AiProviderId[] = ['claude', 'chatgpt', 'groq', 'ollama', 'docker'];
const DEFAULTS: Partial<Record<AiProviderId, string>> = {
  claude: 'claude-haiku-5-5',
  groq: 'openai/gpt-oss-20b',
};

let status: AiStatus;

function emptyStatus(): AiStatus {
  return {
    active: null,
    providers: IDS.map((id) => ({
      id,
      baseUrl: null,
      model: null,
      defaultModel: DEFAULTS[id] ?? null,
      hasKey: false,
    })),
  };
}

/** Rust simulado: guarda en memoria lo que la interfaz le manda. */
function fakeBackend() {
  mocked.aiGetStatus.mockImplementation(() => Promise.resolve(status));
  mocked.aiSaveProvider.mockImplementation((id: AiProviderId, input: AiSaveInput) => {
    status = {
      ...status,
      providers: status.providers.map((p) =>
        p.id !== id
          ? p
          : {
              ...p,
              hasKey: input.apiKey === undefined ? p.hasKey : input.apiKey !== '',
              model: input.model === undefined ? p.model : input.model || null,
              baseUrl: input.baseUrl === undefined ? p.baseUrl : input.baseUrl || null,
            },
      ),
    };
    return Promise.resolve(status);
  });
  mocked.aiSetActive.mockImplementation((id: AiProviderId | null) => {
    status = { ...status, active: id };
    return Promise.resolve(status);
  });
  mocked.aiTestProvider.mockResolvedValue('ok');
  mocked.aiListModels.mockResolvedValue([]);
}

async function openAi() {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'IA' }));
  await act(async () => {});
}

const tab = (name: string) => screen.getByRole('tab', { name });
const choose = async (name: string) => {
  fireEvent.click(tab(name));
  await act(async () => {});
};
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
  await act(async () => {});
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useAiStore.setState({
    status: null,
    models: {},
    busy: null,
    testResult: null,
    saveError: null,
  });
  status = emptyStatus();
  fakeBackend();
  mocked.getAudioPermission.mockResolvedValue('notRequired');
});

describe('página de IA de los ajustes', () => {
  it('explica que las claves se quedan en el equipo, en el llavero', async () => {
    await openAi();
    expect(screen.getByText(/en el llavero del sistema/)).toBeInTheDocument();
    expect(mocked.aiGetStatus).toHaveBeenCalledTimes(1);
  });

  it('ofrece los cinco proveedores, Groq incluido', async () => {
    await openAi();
    const tabs = screen.getByRole('tablist', { name: 'Proveedores de IA' });
    for (const name of ['Claude', 'ChatGPT', 'Groq', 'Ollama', 'Docker']) {
      expect(within(tabs).getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('cada proveedor muestra solo los datos que necesita', async () => {
    await openAi();
    for (const name of ['Claude', 'ChatGPT', 'Groq']) {
      await choose(name);
      expect(screen.getByLabelText('Clave de API')).toHaveAttribute('type', 'password');
      expect(screen.getByLabelText('Modelo')).toBeInTheDocument();
      expect(screen.queryByLabelText('Dirección del servidor')).not.toBeInTheDocument();
    }
    for (const name of ['Ollama', 'Docker']) {
      await choose(name);
      expect(screen.getByLabelText('Dirección del servidor')).toBeInTheDocument();
      expect(screen.getByLabelText('Modelo')).toBeInTheDocument();
      expect(screen.queryByLabelText('Clave de API')).not.toBeInTheDocument();
    }
  });

  it('el modelo por defecto se ve como ejemplo y las direcciones locales también', async () => {
    await openAi();
    await choose('Groq');
    expect(screen.getByLabelText('Modelo')).toHaveAttribute('placeholder', 'openai/gpt-oss-20b');
    await choose('Ollama');
    expect(screen.getByLabelText('Dirección del servidor')).toHaveAttribute(
      'placeholder',
      'http://localhost:11434',
    );
    await choose('Docker');
    expect(screen.getByLabelText('Dirección del servidor')).toHaveAttribute(
      'placeholder',
      'http://localhost:12434/engines/v1',
    );
  });

  it('Guardar solo se activa al escribir y manda la clave y el modelo a Rust', async () => {
    await openAi();
    await choose('Groq');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    type('Clave de API', 'gsk_prueba');
    type('Modelo', 'openai/gpt-oss-120b');
    await click('Guardar');

    expect(mocked.aiSaveProvider).toHaveBeenCalledWith('groq', {
      apiKey: 'gsk_prueba',
      model: 'openai/gpt-oss-120b',
    });
  });

  it('tras guardar, la clave escrita desaparece del campo y queda como "guardada"', async () => {
    await openAi();
    await choose('Groq');
    type('Clave de API', 'gsk_prueba');
    await click('Guardar');

    const field = screen.getByLabelText('Clave de API');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', 'Guardada: escribe otra para reemplazarla');
    expect(document.body.innerHTML).not.toContain('gsk_prueba');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('un proveedor local guarda la dirección y el modelo, sin clave', async () => {
    await openAi();
    await choose('Ollama');
    type('Dirección del servidor', 'http://localhost:11434');
    type('Modelo', 'llama3.2');
    await click('Guardar');

    expect(mocked.aiSaveProvider).toHaveBeenCalledWith('ollama', {
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2',
    });
  });

  it('pasa de "Sin configurar" a "Configurado" y a "En uso"', async () => {
    await openAi();
    await choose('Groq');
    expect(screen.getByText('Sin configurar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar este' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Probar' })).toBeDisabled();

    type('Clave de API', 'gsk_prueba');
    await click('Guardar');
    expect(screen.getByText('Configurado')).toBeInTheDocument();

    await click('Usar este');
    expect(mocked.aiSetActive).toHaveBeenCalledWith('groq');
    expect(screen.getByText('En uso', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'En uso' })).toBeDisabled();
  });

  it('Probar muestra que funciona, con lo que contestó la IA', async () => {
    status.providers = status.providers.map((p) => (p.id === 'groq' ? { ...p, hasKey: true } : p));
    await openAi();
    await choose('Groq');

    await click('Probar');

    expect(mocked.aiTestProvider).toHaveBeenCalledWith('groq');
    expect(screen.getByRole('status')).toHaveTextContent('Funciona: ok');
  });

  it('Probar explica el motivo cuando falla', async () => {
    status.providers = status.providers.map((p) => (p.id === 'groq' ? { ...p, hasKey: true } : p));
    mocked.aiTestProvider.mockRejectedValue({ code: 'ai.unauthorized', message: 'x' });
    await openAi();
    await choose('Groq');

    await click('Probar');

    expect(screen.getByRole('status')).toHaveTextContent(
      'La clave no es válida o no tiene permiso',
    );
  });

  it('si el llavero falla al guardar, lo dice', async () => {
    mocked.aiSaveProvider.mockRejectedValue({ code: 'ai.keychain', message: 'x' });
    await openAi();
    await choose('Groq');
    type('Clave de API', 'gsk_prueba');
    await click('Guardar');

    expect(screen.getByRole('status')).toHaveTextContent('No se pudo usar el llavero del sistema');
  });

  it('ofrece como sugerencias los modelos que da el proveedor, una vez guardada la clave', async () => {
    mocked.aiListModels.mockResolvedValue(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
    status.providers = status.providers.map((p) => (p.id === 'groq' ? { ...p, hasKey: true } : p));
    await openAi();
    await choose('Groq');

    const options = document.querySelectorAll('datalist#ai-models-groq option');
    expect([...options].map((o) => o.getAttribute('value'))).toEqual([
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
    ]);
    expect(mocked.aiListModels).toHaveBeenCalledWith('groq');
  });

  it('sin clave no pide los modelos', async () => {
    await openAi();
    await choose('Claude');
    expect(mocked.aiListModels).not.toHaveBeenCalled();
  });

  it('Quitar clave borra la guardada', async () => {
    status.providers = status.providers.map((p) => (p.id === 'groq' ? { ...p, hasKey: true } : p));
    await openAi();
    await choose('Groq');

    await click('Quitar clave');

    expect(mocked.aiSaveProvider).toHaveBeenCalledWith('groq', { apiKey: '' });
    expect(screen.queryByRole('button', { name: 'Quitar clave' })).not.toBeInTheDocument();
  });

  it('al abrir muestra el proveedor que está en uso', async () => {
    status.active = 'groq';
    await openAi();
    expect(tab('Groq')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('En uso', { selector: 'span' })).toBeInTheDocument();
  });

  it('se traduce al inglés', async () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'AI' }));
    await act(async () => {});
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    expect(
      screen.getByText(/stored only on this computer, in the system keychain/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
