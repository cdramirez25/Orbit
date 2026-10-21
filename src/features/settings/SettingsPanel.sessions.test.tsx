import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { useSessionStore } from '@/stores/session.store';
import type { AiProviderId, AiStatus, SessionMessage, SessionsState, SessionUpdate } from '@/types';

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
    sessionGetState: vi.fn(),
    sessionCreate: vi.fn(),
    sessionUpdate: vi.fn(),
    sessionDelete: vi.fn(),
    sessionSetActive: vi.fn(),
    sessionMessages: vi.fn(),
    sessionClear: vi.fn(),
    aiGetStatus: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

let aiStatus: AiStatus;
let state: SessionsState;
let messages: SessionMessage[];
let nextId: number;

/** Rust simulado: guarda en memoria lo que la interfaz le manda. */
function fakeBackend() {
  mocked.sessionGetState.mockImplementation(() => Promise.resolve(state));
  mocked.sessionMessages.mockImplementation(() => Promise.resolve(messages));
  mocked.sessionCreate.mockImplementation((name: string, prompt?: string) => {
    if (name.trim() === '') return Promise.reject({ code: 'session.emptyName', message: 'x' });
    nextId += 1;
    const session = {
      id: nextId,
      name: name.trim(),
      prompt: prompt ?? '',
      autoAnswer: false,
      provider: null,
      createdAt: 0,
    };
    state = { active: session.id, sessions: [session, ...state.sessions] };
    return Promise.resolve(state);
  });
  mocked.sessionUpdate.mockImplementation((id: number, update: SessionUpdate) => {
    if (update.name !== undefined && update.name.trim() === '') {
      return Promise.reject({ code: 'session.emptyName', message: 'x' });
    }
    state = {
      ...state,
      sessions: state.sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              ...update,
              provider: update.provider === undefined ? s.provider : update.provider || null,
            }
          : s,
      ),
    };
    return Promise.resolve(state);
  });
  mocked.sessionSetActive.mockImplementation((id: number | null) => {
    state = { ...state, active: id };
    return Promise.resolve(state);
  });
  mocked.sessionDelete.mockImplementation((id: number) => {
    const sessions = state.sessions.filter((s) => s.id !== id);
    state = { sessions, active: sessions[0]?.id ?? null };
    return Promise.resolve(state);
  });
  mocked.aiGetStatus.mockImplementation(() => Promise.resolve(aiStatus));
  mocked.sessionClear.mockImplementation(() => {
    messages = [];
    return Promise.resolve();
  });
}

async function openSessions() {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Sesiones' }));
  await act(async () => {});
}

const click = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
  await act(async () => {});
};
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useSessionStore.setState({ state: null, messages: [], errorCode: null });
  state = {
    active: 2,
    sessions: [
      {
        id: 2,
        name: 'Trivia',
        prompt: 'Responde corto',
        autoAnswer: false,
        provider: null,
        createdAt: 0,
      },
      { id: 1, name: 'Reunión', prompt: '', autoAnswer: false, provider: null, createdAt: 0 },
    ],
  };
  messages = [
    { id: 1, role: 'user', content: '¿Capital de Francia?', createdAt: 0 },
    { id: 2, role: 'assistant', content: 'París.', createdAt: 0 },
  ];
  nextId = 2;
  // La IA en uso es Groq (con clave); Claude no tiene clave; Ollama es local con su modelo por defecto.
  const provider = (id: AiProviderId, hasKey: boolean, defaultModel: string | null) => ({
    id,
    baseUrl: null,
    model: null,
    defaultModel,
    hasKey,
  });
  aiStatus = {
    active: 'groq',
    providers: [
      provider('claude', false, 'claude-haiku-5-5'),
      provider('chatgpt', false, null),
      provider('groq', true, 'openai/gpt-oss-20b'),
      provider('ollama', false, 'llama3.2'),
      provider('docker', false, null),
    ],
  };
  fakeBackend();
});

describe('página de sesiones de los ajustes', () => {
  it('lista las sesiones y muestra la activa con su prompt e historial', async () => {
    await openSessions();

    expect(screen.getByRole('button', { name: 'Trivia' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Reunión' })).not.toHaveAttribute('aria-current');
    expect(screen.getByLabelText('Nombre')).toHaveValue('Trivia');
    expect(screen.getByLabelText('Prompt de la sesión')).toHaveValue('Responde corto');
    expect(screen.getByText('¿Capital de Francia?')).toBeInTheDocument();
    expect(screen.getByText('París.')).toBeInTheDocument();
  });

  it('sin sesiones invita a crear una', async () => {
    state = { active: null, sessions: [] };
    await openSessions();
    expect(
      screen.getByText(/Crea una sesión para que la IA tenga el contexto/),
    ).toBeInTheDocument();
  });

  it('"Nueva sesión" crea una con nombre por defecto y la deja activa', async () => {
    await openSessions();
    await click('Nueva sesión');

    expect(mocked.sessionCreate).toHaveBeenCalledWith('Sesión 3', '');
    expect(screen.getByLabelText('Nombre')).toHaveValue('Sesión 3');
    expect(screen.getByRole('button', { name: 'Sesión 3' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('elegir otra sesión la deja activa y muestra la suya', async () => {
    await openSessions();
    await click('Reunión');

    expect(mocked.sessionSetActive).toHaveBeenCalledWith(1);
    expect(screen.getByLabelText('Nombre')).toHaveValue('Reunión');
    expect(screen.getByLabelText('Prompt de la sesión')).toHaveValue('');
  });

  it('Guardar solo se activa al cambiar algo y manda el nombre y el prompt', async () => {
    await openSessions();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    type('Prompt de la sesión', 'Eres un experto en geografía');
    type('Nombre', 'Geografía');
    await click('Guardar');

    expect(mocked.sessionUpdate).toHaveBeenCalledWith(2, {
      name: 'Geografía',
      prompt: 'Eres un experto en geografía',
    });
    expect(screen.getByRole('button', { name: 'Geografía' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('un nombre vacío no se guarda y dice por qué', async () => {
    await openSessions();
    type('Nombre', '   ');
    await click('Guardar');

    expect(screen.getByRole('alert')).toHaveTextContent('La sesión necesita un nombre');
  });

  it('el interruptor de responder sola se guarda al momento', async () => {
    await openSessions();
    fireEvent.click(screen.getByRole('switch', { name: 'Contestar sola las preguntas que oiga' }));
    await act(async () => {});

    expect(mocked.sessionUpdate).toHaveBeenCalledWith(2, { autoAnswer: true });
    expect(
      screen.getByRole('switch', { name: 'Contestar sola las preguntas que oiga' }),
    ).toBeChecked();
  });

  it('borrar el historial conserva la sesión y su prompt', async () => {
    await openSessions();
    await click('Borrar historial');

    expect(mocked.sessionClear).toHaveBeenCalledWith(2);
    expect(screen.getByText('Todavía no hay preguntas en esta sesión.')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt de la sesión')).toHaveValue('Responde corto');
    expect(screen.getByRole('button', { name: 'Borrar historial' })).toBeDisabled();
  });

  it('borrar la sesión pide confirmar y se puede cancelar', async () => {
    await openSessions();
    await click('Borrar sesión');
    expect(mocked.sessionDelete).not.toHaveBeenCalled(); // primero confirma

    await click('Cancelar');
    expect(screen.getByRole('button', { name: 'Borrar sesión' })).toBeInTheDocument();
    expect(mocked.sessionDelete).not.toHaveBeenCalled();

    await click('Borrar sesión');
    await click('Borrar sesión'); // el botón rojo de confirmar
    expect(mocked.sessionDelete).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('button', { name: 'Trivia' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Reunión');
  });

  it('se traduce al inglés', async () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    await act(async () => {});

    expect(screen.getByLabelText('Session prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
    expect(screen.getByText('Question')).toBeInTheDocument();
  });

  describe('IA de la sesión', () => {
    const picker = () => screen.getByRole('tablist', { name: 'IA de esta sesión' });

    it('ofrece "Predeterminada" y solo las IA que tiene registradas', async () => {
      await openSessions();

      const names = [...picker().querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
      expect(names).toEqual(['Predeterminada', 'Groq', 'Ollama']); // sin Claude, ChatGPT ni Docker
      expect(screen.getByRole('tab', { name: 'Predeterminada' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        screen.getByText(/Usa la IA que esté en uso en Ajustes, sección IA \(Groq\)/),
      ).toBeInTheDocument();
    });

    it('elegir una IA la guarda en la sesión y elegir "Predeterminada" la quita', async () => {
      await openSessions();

      fireEvent.click(screen.getByRole('tab', { name: 'Groq' }));
      await act(async () => {});
      expect(mocked.sessionUpdate).toHaveBeenLastCalledWith(2, { provider: 'groq' });
      expect(screen.getByRole('tab', { name: 'Groq' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Esta sesión siempre le pregunta a esta IA.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Predeterminada' }));
      await act(async () => {});
      expect(mocked.sessionUpdate).toHaveBeenLastCalledWith(2, { provider: '' });
      expect(screen.getByRole('tab', { name: 'Predeterminada' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('cada sesión recuerda su propia IA', async () => {
      state.sessions[1] = { ...state.sessions[1]!, provider: 'ollama' };
      await openSessions();
      expect(screen.getByRole('tab', { name: 'Predeterminada' })).toHaveAttribute(
        'aria-selected',
        'true',
      );

      await click('Reunión');
      expect(screen.getByRole('tab', { name: 'Ollama' })).toHaveAttribute('aria-selected', 'true');
    });

    it('la IA de la sesión se ve aunque ya no esté configurada, para poder cambiarla', async () => {
      state.sessions[0] = { ...state.sessions[0]!, provider: 'claude' };
      await openSessions();
      expect(screen.getByRole('tab', { name: 'Claude' })).toHaveAttribute('aria-selected', 'true');
    });

    it('sin ninguna IA registrada manda a configurarla', async () => {
      aiStatus = {
        active: null,
        providers: aiStatus.providers.map((p) => ({ ...p, hasKey: false, defaultModel: null })),
      };
      await openSessions();
      expect(screen.getByText(/Todavía no hay ninguna IA configurada/)).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Predeterminada' })).toBeInTheDocument();
    });
  });
});
