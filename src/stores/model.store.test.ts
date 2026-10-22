import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useModelStore } from '@/stores/model.store';
import type { ModelStatus } from '@/types';

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());

vi.mock('@/ipc/events', () => ({
  onEvent: vi.fn((name: string, handler: (payload: unknown) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));

vi.mock('@/ipc/commands', () => ({
  commands: {
    sttModelStatus: vi.fn(),
    sttModelDownload: vi.fn(),
    sttModelCancel: vi.fn(),
    sttModelRemove: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const status = (overrides: Partial<ModelStatus> = {}): ModelStatus => ({
  state: 'missing',
  downloaded: 0,
  total: 1000,
  error: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  useModelStore.setState({ status: null, errorCode: null });
});

describe('modelo de transcripción', () => {
  it('al enlazar pide el estado y sigue los cambios que avisa Rust', async () => {
    mocked.sttModelStatus.mockResolvedValue(status());
    await useModelStore.getState().bind();
    expect(useModelStore.getState().status).toEqual(status());

    handlers.get('stt:model')?.(status({ state: 'downloading', downloaded: 400 }));
    expect(useModelStore.getState().status).toMatchObject({
      state: 'downloading',
      downloaded: 400,
    });

    handlers.get('stt:model')?.(status({ state: 'ready', downloaded: 1000 }));
    expect(useModelStore.getState().status?.state).toBe('ready');
  });

  it('si no se puede consultar el estado, se queda sin él', async () => {
    mocked.sttModelStatus.mockRejectedValue(new Error('sin respuesta'));
    await useModelStore.getState().bind();
    expect(useModelStore.getState().status).toBeNull();
  });

  it('descargar pide a Rust que empiece y limpia el error anterior', async () => {
    useModelStore.setState({ errorCode: 'stt.model.network' });
    mocked.sttModelDownload.mockResolvedValue();

    await useModelStore.getState().download();

    expect(mocked.sttModelDownload).toHaveBeenCalledTimes(1);
    expect(useModelStore.getState().errorCode).toBeNull();
  });

  it('un fallo al empezar la descarga guarda su código', async () => {
    mocked.sttModelDownload.mockRejectedValue({ code: 'stt.model.disk', message: 'x' });
    await useModelStore.getState().download();
    expect(useModelStore.getState().errorCode).toBe('stt.model.disk');
  });

  it('borrar con la descarga en curso guarda el aviso de que está ocupado', async () => {
    mocked.sttModelRemove.mockRejectedValue({ code: 'stt.model.busy', message: 'x' });
    await useModelStore.getState().remove();
    expect(useModelStore.getState().errorCode).toBe('stt.model.busy');
  });

  it('cancelar se lo pide a Rust y no falla si Rust no contesta', async () => {
    mocked.sttModelCancel.mockRejectedValue(new Error('x'));
    await expect(useModelStore.getState().cancel()).resolves.toBeUndefined();
    expect(mocked.sttModelCancel).toHaveBeenCalledTimes(1);
  });

  it('un estado nuevo borra el error de la orden anterior', async () => {
    mocked.sttModelStatus.mockResolvedValue(status());
    await useModelStore.getState().bind();
    useModelStore.setState({ errorCode: 'stt.model.busy' });

    handlers.get('stt:model')?.(status({ state: 'ready', downloaded: 1000 }));

    expect(useModelStore.getState().errorCode).toBeNull();
  });
});
