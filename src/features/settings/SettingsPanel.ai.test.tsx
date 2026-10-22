import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    aiAsk: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const IDS: AiProviderId[] = ['claude', 'chatgpt', 'groq', 'gemini', 'ollama', 'docker'];
const DEFAULTS: Partial<Record<AiProviderId, string>> = {
  claude: 'claude-haiku-5-5',
  groq: 'openai/gpt-oss-20b',
  gemini: 'gemini-3.5-flash-lite',
};

/** Lo que "ofrece" cada proveedor en estos tests. */
const MODEL_LISTS: Partial<Record<AiProviderId, string[]>> = {
  claude: ['claude-haiku-5-5', 'claude-opus-5-5'],
  chatgpt: ['gpt-ejemplo'],
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  gemini: ['gemini-2.5-flash', 'gemini-3.5-flash-lite'],
  ollama: ['llama3.2', 'qwen3'],
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
  mocked.aiListModels.mockImplementation((id: AiProviderId) =>
    Promise.resolve(MODEL_LISTS[id] ?? []),
  );
  mocked.aiAsk.mockResolvedValue();
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
/** Escribe la clave y espera la pausa tras la que se piden los modelos con ella (reloj falso). */
const typeKey = async (value: string) => {
  type('Clave de API', value);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
};
const click = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
  await act(async () => {});
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useAiStore.setState({
    status: null,
    models: {},
    typedModels: {},
    busy: null,
    testResult: null,
    saveError: null,
  });
  status = emptyStatus();
  fakeBackend();
  mocked.getAudioPermission.mockResolvedValue('notRequired');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('página de IA de los ajustes', () => {
  it('explica que las claves se quedan en el equipo, en SQLite', async () => {
    await openAi();
    expect(screen.getByText(/en una base de datos SQLite local/)).toBeInTheDocument();
    expect(mocked.aiGetStatus).toHaveBeenCalledTimes(1);
  });

  it('ofrece los seis proveedores, Groq y Gemini incluidos', async () => {
    await openAi();
    const tabs = screen.getByRole('tablist', { name: 'Proveedores de IA' });
    for (const name of ['Claude', 'ChatGPT', 'Groq', 'Gemini', 'Ollama', 'Docker']) {
      expect(within(tabs).getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('cada proveedor muestra solo los datos que necesita', async () => {
    await openAi();
    for (const name of ['Claude', 'ChatGPT', 'Groq', 'Gemini']) {
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

  it('en la nube el modelo es un selector, desactivado hasta que haya clave, con el modelo por defecto', async () => {
    await openAi();
    await choose('Groq');
    const select = screen.getByLabelText('Modelo');
    expect(select.tagName).toBe('SELECT');
    expect(select).toBeDisabled();
    expect(select).toHaveDisplayValue('Predeterminado (openai/gpt-oss-20b)');
    expect(screen.getByText(/Escribe la clave para elegir/)).toBeInTheDocument();
    expect(mocked.aiListModels).not.toHaveBeenCalled();
  });

  it('ChatGPT no tiene modelo por defecto: pide elegir uno', async () => {
    await openAi();
    await choose('ChatGPT');
    expect(screen.getByLabelText('Modelo')).toHaveDisplayValue('Elige un modelo');
  });

  it('las direcciones locales se ven como ejemplo y su modelo se escribe, con sugerencias', async () => {
    await openAi();
    await choose('Ollama');
    const input = screen.getByLabelText('Modelo');
    expect(input.tagName).toBe('INPUT');
    const suggestions = document.querySelectorAll('datalist#ai-models-ollama option');
    expect([...suggestions].map((o) => o.getAttribute('value'))).toEqual(['llama3.2', 'qwen3']);
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

  it('Gemini: al escribir la clave aparecen sus modelos para elegir uno, antes de guardar', async () => {
    await openAi();
    await choose('Gemini');
    expect(screen.getByLabelText('Clave de API')).toHaveAttribute('placeholder', 'AIza…');

    await typeKey('AQ.prueba');
    // Se pidieron con la clave escrita y todavía no se guardó nada.
    expect(mocked.aiListModels).toHaveBeenCalledWith('gemini', 'AQ.prueba');
    expect(mocked.aiSaveProvider).not.toHaveBeenCalled();
    const select = screen.getByLabelText('Modelo');
    expect(select).toBeEnabled();
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Predeterminado (gemini-3.5-flash-lite)',
      'gemini-2.5-flash',
      'gemini-3.5-flash-lite',
    ]);

    fireEvent.change(select, { target: { value: 'gemini-2.5-flash' } });
    await click('Guardar');

    expect(mocked.aiSaveProvider).toHaveBeenCalledWith('gemini', {
      apiKey: 'AQ.prueba',
      model: 'gemini-2.5-flash',
    });
    expect(document.body.innerHTML).not.toContain('AQ.prueba');
  });

  it('mientras se escribe la clave espera una pausa antes de pedir los modelos', async () => {
    await openAi();
    await choose('Gemini');

    type('Clave de API', 'A');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    type('Clave de API', 'AQ.prue');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mocked.aiListModels).not.toHaveBeenCalled();
    expect(screen.getByText(/Buscando los modelos/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mocked.aiListModels).toHaveBeenCalledTimes(1);
    expect(mocked.aiListModels).toHaveBeenCalledWith('gemini', 'AQ.prue');
  });

  it('si la clave escrita no sirve, lo dice y deja solo el modelo por defecto', async () => {
    mocked.aiListModels.mockRejectedValue({ code: 'ai.unauthorized', message: 'x' });
    await openAi();
    await choose('Gemini');
    await typeKey('AQ.mala');

    expect(screen.getByLabelText('Modelo').tagName).toBe('SELECT');
    expect(screen.getByText(/revisa la clave/)).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('al borrar la clave escrita vuelve a pedir una clave y se desactiva el selector', async () => {
    await openAi();
    await choose('Groq');
    await typeKey('gsk_x');
    expect(screen.getByLabelText('Modelo')).toBeEnabled();

    await typeKey('');
    expect(screen.getByLabelText('Modelo')).toBeDisabled();
    expect(screen.getByText(/Escribe la clave para elegir/)).toBeInTheDocument();
  });

  it('las listas de claves viejas no pisan a la de la última clave escrita', async () => {
    let resolveSlow: (models: string[]) => void = () => {};
    mocked.aiListModels
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)))
      .mockImplementationOnce(() => Promise.resolve(['modelo-nuevo']));
    await openAi();
    await choose('Groq');
    await typeKey('gsk_vieja');
    await typeKey('gsk_nueva');
    resolveSlow(['modelo-viejo']);
    await act(async () => {});

    const options = [...screen.getByLabelText('Modelo').querySelectorAll('option')];
    expect(options.map((o) => o.textContent)).toContain('modelo-nuevo');
    expect(options.map((o) => o.textContent)).not.toContain('modelo-viejo');
  });

  it('Guardar solo se activa al escribir y manda la clave y el modelo a Rust', async () => {
    await openAi();
    await choose('Groq');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    await typeKey('gsk_prueba');
    fireEvent.change(screen.getByLabelText('Modelo'), {
      target: { value: 'openai/gpt-oss-120b' },
    });
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

  it('si no se puede guardar la clave, lo dice', async () => {
    mocked.aiSaveProvider.mockRejectedValue({ code: 'ai.storage', message: 'x' });
    await openAi();
    await choose('Groq');
    type('Clave de API', 'gsk_prueba');
    await click('Guardar');

    expect(screen.getByRole('status')).toHaveTextContent(
      'No se pudo guardar la clave en este equipo',
    );
  });

  it('con la clave guardada, el modelo se elige de la lista que da el proveedor', async () => {
    mocked.aiListModels.mockResolvedValue(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
    status.providers = status.providers.map((p) => (p.id === 'groq' ? { ...p, hasKey: true } : p));
    await openAi();
    await choose('Groq');

    const select = screen.getByLabelText('Modelo');
    expect(select.tagName).toBe('SELECT');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Predeterminado (openai/gpt-oss-20b)',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
    ]);
    expect(mocked.aiListModels).toHaveBeenCalledWith('groq');

    fireEvent.change(select, { target: { value: 'openai/gpt-oss-120b' } });
    await click('Guardar');
    expect(mocked.aiSaveProvider).toHaveBeenCalledWith('groq', { model: 'openai/gpt-oss-120b' });
  });

  it('un modelo guardado que el proveedor ya no ofrece sigue en la lista', async () => {
    mocked.aiListModels.mockResolvedValue(['gemini-2.5-pro']);
    status.providers = status.providers.map((p) =>
      p.id === 'gemini' ? { ...p, hasKey: true, model: 'gemini-viejo' } : p,
    );
    await openAi();
    await choose('Gemini');

    const select = screen.getByLabelText('Modelo') as HTMLSelectElement;
    expect(select.value).toBe('gemini-viejo');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'gemini-viejo', 'gemini-2.5-pro']);
  });

  it('Actualizar lista vuelve a pedir los modelos', async () => {
    mocked.aiListModels.mockResolvedValue(['a']);
    status.providers = status.providers.map((p) =>
      p.id === 'gemini' ? { ...p, hasKey: true } : p,
    );
    await openAi();
    await choose('Gemini');
    expect(mocked.aiListModels).toHaveBeenCalledTimes(1);

    mocked.aiListModels.mockResolvedValue(['a', 'b']);
    await click('Actualizar lista');

    expect(mocked.aiListModels).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('option', { name: 'b' })).toBeInTheDocument();
  });

  it('si la lista de una clave guardada no llega, el selector sigue y se puede reintentar', async () => {
    mocked.aiListModels.mockRejectedValue(new Error('sin red'));
    status.providers = status.providers.map((p) => (p.id === 'groq' ? { ...p, hasKey: true } : p));
    await openAi();
    await choose('Groq');

    expect(screen.getByLabelText('Modelo').tagName).toBe('SELECT');
    expect(screen.getByText(/No se pudo obtener la lista/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actualizar lista' })).toBeInTheDocument();
  });

  it('un proveedor local sin lista deja escribir el modelo a mano', async () => {
    await openAi();
    await choose('Docker');
    expect(screen.getByLabelText('Modelo').tagName).toBe('INPUT');
    expect(screen.getByText(/escribe el nombre del modelo/)).toBeInTheDocument();
  });

  it('sin clave no hay botón de actualizar la lista', async () => {
    await openAi();
    await choose('Gemini');
    expect(screen.queryByRole('button', { name: 'Actualizar lista' })).not.toBeInTheDocument();
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
      screen.getByText(/stored only on this computer, in a local SQLite database/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  describe('caja para preguntarle algo', () => {
    const questionField = () => screen.getByLabelText('Pregúntale algo');

    it('sin proveedor en uso pide elegir uno y no deja preguntar', async () => {
      await openAi();
      type('Pregúntale algo', '¿Qué hora es?');

      expect(screen.getByText('Primero elige un proveedor con «Usar este».')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Preguntar' })).toBeDisabled();
    });

    it('con un proveedor en uso manda la pregunta y dice que la respuesta sale en la isla', async () => {
      status.active = 'groq';
      await openAi();
      expect(screen.getByRole('button', { name: 'Preguntar' })).toBeDisabled(); // vacía

      type('Pregúntale algo', '  ¿Cuál es la capital de Australia?  ');
      await click('Preguntar');

      expect(mocked.aiAsk).toHaveBeenCalledTimes(1);
      expect(mocked.aiAsk).toHaveBeenCalledWith('¿Cuál es la capital de Australia?');
      expect(screen.getByText(/La respuesta aparece en la isla/)).toBeInTheDocument();
    });

    it('Enter también pregunta, y una pregunta en blanco no se manda', async () => {
      status.active = 'groq';
      await openAi();

      type('Pregúntale algo', '   ');
      fireEvent.submit(questionField().closest('form') as HTMLFormElement);
      expect(mocked.aiAsk).not.toHaveBeenCalled();

      type('Pregúntale algo', 'Hola?');
      fireEvent.submit(questionField().closest('form') as HTMLFormElement);
      expect(mocked.aiAsk).toHaveBeenCalledWith('Hola?');
    });
  });

  it('en Audio explica para qué sirve Escuchar y cuándo responde la IA', async () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    await act(async () => {});
    expect(screen.getByText(/la isla mostrará lo que se transcribe/)).toBeInTheDocument();
    expect(
      screen.getByText(/Si una sesión responde sola, también contestará las preguntas que oiga/),
    ).toBeInTheDocument();
  });
});
