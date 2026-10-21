import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { selectActiveSession, useSessionStore } from '@/stores/session.store';
import type { SessionMessage, SessionsState } from '@/types';

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());

vi.mock('@/ipc/events', () => ({
  onEvent: vi.fn((name: string, handler: (payload: unknown) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));

vi.mock('@/ipc/commands', () => ({
  commands: {
    sessionGetState: vi.fn(),
    sessionCreate: vi.fn(),
    sessionUpdate: vi.fn(),
    sessionDelete: vi.fn(),
    sessionSetActive: vi.fn(),
    sessionMessages: vi.fn(),
    sessionClear: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const state = (active: number | null, ...ids: number[]): SessionsState => ({
  active,
  sessions: ids.map((id) => ({
    id,
    name: `S${id}`,
    prompt: '',
    autoAnswer: false,
    provider: null,
    createdAt: 0,
  })),
});

const message = (id: number, role: 'user' | 'assistant', content: string): SessionMessage => ({
  id,
  role,
  content,
  createdAt: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  useSessionStore.setState({ state: null, messages: [], errorCode: null });
  mocked.sessionMessages.mockResolvedValue([]);
});

describe('store de sesiones', () => {
  it('load trae las sesiones y el historial de la activa', async () => {
    mocked.sessionGetState.mockResolvedValue(state(2, 2, 1));
    mocked.sessionMessages.mockResolvedValue([
      message(1, 'user', 'hola'),
      message(2, 'assistant', 'qué tal'),
    ]);

    await useSessionStore.getState().load();

    expect(useSessionStore.getState().state?.active).toBe(2);
    expect(mocked.sessionMessages).toHaveBeenCalledWith(2);
    expect(useSessionStore.getState().messages).toHaveLength(2);
    expect(selectActiveSession(useSessionStore.getState())?.name).toBe('S2');
  });

  it('sin sesión activa no hay historial ni se pide', async () => {
    mocked.sessionGetState.mockResolvedValue(state(null));
    await useSessionStore.getState().load();

    expect(mocked.sessionMessages).not.toHaveBeenCalled();
    expect(useSessionStore.getState().messages).toEqual([]);
    expect(selectActiveSession(useSessionStore.getState())).toBeNull();
  });

  it('si load falla conserva lo que había', async () => {
    useSessionStore.setState({ state: state(1, 1) });
    mocked.sessionGetState.mockRejectedValue(new Error('x'));

    await useSessionStore.getState().load();

    expect(useSessionStore.getState().state?.active).toBe(1);
  });

  it('create manda el nombre y el prompt y deja la nueva como activa', async () => {
    mocked.sessionCreate.mockResolvedValue(state(5, 5, 1));

    const ok = await useSessionStore.getState().create('Trivia', 'Responde corto');

    expect(ok).toBe(true);
    expect(mocked.sessionCreate).toHaveBeenCalledWith('Trivia', 'Responde corto');
    expect(useSessionStore.getState().state?.active).toBe(5);
  });

  it('un error al guardar deja su código y devuelve false', async () => {
    mocked.sessionCreate.mockRejectedValue({ code: 'session.emptyName', message: 'x' });
    expect(await useSessionStore.getState().create('  ')).toBe(false);
    expect(useSessionStore.getState().errorCode).toBe('session.emptyName');

    // El siguiente cambio que sale bien limpia el error.
    mocked.sessionUpdate.mockResolvedValue(state(1, 1));
    await useSessionStore.getState().update(1, { prompt: 'x' });
    expect(useSessionStore.getState().errorCode).toBeNull();
  });

  it('update, setActive y remove usan los comandos y aplican el estado que devuelve Rust', async () => {
    mocked.sessionUpdate.mockResolvedValue(state(1, 1));
    await useSessionStore.getState().update(1, { name: 'Nuevo', autoAnswer: true });
    expect(mocked.sessionUpdate).toHaveBeenCalledWith(1, { name: 'Nuevo', autoAnswer: true });

    mocked.sessionSetActive.mockResolvedValue(state(2, 2, 1));
    await useSessionStore.getState().setActive(2);
    expect(mocked.sessionSetActive).toHaveBeenCalledWith(2);
    expect(useSessionStore.getState().state?.active).toBe(2);

    mocked.sessionDelete.mockResolvedValue(state(1, 1));
    await useSessionStore.getState().remove(2);
    expect(mocked.sessionDelete).toHaveBeenCalledWith(2);
    expect(useSessionStore.getState().state?.sessions).toHaveLength(1);
  });

  it('borrar el historial lo pide a Rust y vuelve a cargar', async () => {
    mocked.sessionClear.mockResolvedValue();
    mocked.sessionGetState.mockResolvedValue(state(1, 1));

    await useSessionStore.getState().clearHistory(1);

    expect(mocked.sessionClear).toHaveBeenCalledWith(1);
    expect(mocked.sessionGetState).toHaveBeenCalled();
  });

  it('bind recarga cada vez que Rust avisa de un cambio (otra ventana, una respuesta nueva)', async () => {
    mocked.sessionGetState.mockResolvedValue(state(1, 1));
    const unbind = await useSessionStore.getState().bind();
    expect(mocked.sessionGetState).toHaveBeenCalledTimes(1);

    handlers.get('sessions:changed')?.(null);
    await vi.waitFor(() => expect(mocked.sessionGetState).toHaveBeenCalledTimes(2));

    unbind();
    expect(handlers.size).toBe(0);
  });

  it('un historial que llega tarde, de una sesión que ya no es la activa, se descarta', async () => {
    let resolveSlow: (value: SessionMessage[]) => void = () => {};
    mocked.sessionMessages.mockImplementationOnce(
      () => new Promise<SessionMessage[]>((resolve) => (resolveSlow = resolve)),
    );
    mocked.sessionGetState.mockResolvedValue(state(1, 2, 1));
    const loading = useSessionStore.getState().load();

    // Mientras tanto se cambia a otra sesión.
    mocked.sessionSetActive.mockResolvedValue(state(2, 2, 1));
    mocked.sessionMessages.mockResolvedValueOnce([message(9, 'user', 'de la sesión 2')]);
    await useSessionStore.getState().setActive(2);

    resolveSlow([message(1, 'user', 'de la sesión 1')]);
    await loading;

    expect(useSessionStore.getState().messages.map((m) => m.content)).toEqual(['de la sesión 2']);
  });
});
