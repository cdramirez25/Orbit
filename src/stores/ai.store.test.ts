import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useAiStore } from '@/stores/ai.store';
import type { AiStatus } from '@/types';

vi.mock('@/ipc/commands', () => ({
  commands: {
    aiGetStatus: vi.fn(),
    aiSaveProvider: vi.fn(),
    aiSetActive: vi.fn(),
    aiTestProvider: vi.fn(),
    aiListModels: vi.fn(),
    aiAsk: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const status = (active: AiStatus['active'] = null, hasKey = false): AiStatus => ({
  active,
  providers: [{ id: 'groq', baseUrl: null, model: null, defaultModel: 'm', hasKey }],
});

beforeEach(() => {
  vi.clearAllMocks();
  useAiStore.setState({
    status: null,
    models: {},
    busy: null,
    testResult: null,
    saveError: null,
  });
});

describe('store de IA', () => {
  it('load guarda lo que dice Rust y, si falla, conserva lo que había', async () => {
    mocked.aiGetStatus.mockResolvedValue(status('groq'));
    await useAiStore.getState().load();
    expect(useAiStore.getState().status?.active).toBe('groq');

    mocked.aiGetStatus.mockRejectedValue(new Error('sin respuesta'));
    await useAiStore.getState().load();
    expect(useAiStore.getState().status?.active).toBe('groq');
  });

  it('save manda lo escrito, actualiza el estado y olvida las sugerencias de modelos de antes', async () => {
    useAiStore.setState({ models: { groq: ['viejo'], claude: ['otro'] } });
    mocked.aiSaveProvider.mockResolvedValue(status(null, true));

    const ok = await useAiStore.getState().save('groq', { apiKey: 'gsk_x', model: 'm' });

    expect(ok).toBe(true);
    expect(mocked.aiSaveProvider).toHaveBeenCalledWith('groq', { apiKey: 'gsk_x', model: 'm' });
    expect(useAiStore.getState().status?.providers[0]?.hasKey).toBe(true);
    expect(useAiStore.getState().models.groq).toBeUndefined();
    expect(useAiStore.getState().models.claude).toEqual(['otro']);
    expect(useAiStore.getState().busy).toBeNull();
  });

  it('save guarda el código del error y devuelve false', async () => {
    mocked.aiSaveProvider.mockRejectedValue({ code: 'ai.storage', message: 'x' });
    const ok = await useAiStore.getState().save('groq', { apiKey: 'gsk_x' });

    expect(ok).toBe(false);
    expect(useAiStore.getState().saveError).toEqual({ id: 'groq', code: 'ai.storage' });
    expect(useAiStore.getState().busy).toBeNull();

    mocked.aiSaveProvider.mockRejectedValue(new Error('raro'));
    await useAiStore.getState().save('groq', {});
    expect(useAiStore.getState().saveError).toEqual({ id: 'groq', code: 'unknown' });
  });

  it('la clave nunca queda guardada en el store', async () => {
    mocked.aiSaveProvider.mockResolvedValue(status(null, true));
    await useAiStore.getState().save('groq', { apiKey: 'gsk_secreta' });
    expect(JSON.stringify(useAiStore.getState().status)).not.toContain('gsk_secreta');
  });

  it('setActive cambia el proveedor y, si falla, vuelve a pedir lo real', async () => {
    mocked.aiSetActive.mockResolvedValue(status('groq'));
    await useAiStore.getState().setActive('groq');
    expect(mocked.aiSetActive).toHaveBeenCalledWith('groq');
    expect(useAiStore.getState().status?.active).toBe('groq');

    mocked.aiSetActive.mockRejectedValue(new Error('x'));
    mocked.aiGetStatus.mockResolvedValue(status(null));
    await useAiStore.getState().setActive('claude');
    expect(mocked.aiGetStatus).toHaveBeenCalled();
    expect(useAiStore.getState().status?.active).toBeNull();
  });

  it('test guarda lo que contestó la IA o el código del fallo', async () => {
    mocked.aiTestProvider.mockResolvedValue('ok');
    await useAiStore.getState().test('groq');
    expect(useAiStore.getState().testResult).toEqual({ id: 'groq', ok: true, reply: 'ok' });

    mocked.aiTestProvider.mockRejectedValue({ code: 'ai.rateLimited', message: 'x' });
    await useAiStore.getState().test('groq');
    expect(useAiStore.getState().testResult).toEqual({
      id: 'groq',
      ok: false,
      code: 'ai.rateLimited',
    });
    expect(useAiStore.getState().busy).toBeNull();
  });

  it('loadModels guarda la lista y, si falla, una lista vacía (el modelo se puede escribir)', async () => {
    mocked.aiListModels.mockResolvedValue(['a', 'b']);
    await useAiStore.getState().loadModels('groq');
    expect(useAiStore.getState().models.groq).toEqual(['a', 'b']);

    mocked.aiListModels.mockRejectedValue(new Error('x'));
    await useAiStore.getState().loadModels('claude');
    expect(useAiStore.getState().models.claude).toEqual([]);
  });

  it('ask manda la pregunta y, si falla, no rompe nada', async () => {
    mocked.aiAsk.mockResolvedValue();
    await useAiStore.getState().ask('¿Hola?');
    expect(mocked.aiAsk).toHaveBeenCalledWith('¿Hola?');

    mocked.aiAsk.mockRejectedValue(new Error('x'));
    await expect(useAiStore.getState().ask('otra')).resolves.toBeUndefined();
  });
});
