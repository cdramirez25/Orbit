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
    sttModelChooseDir: vi.fn(),
    sttModelResetDir: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const status = (overrides: Partial<ModelStatus> = {}): ModelStatus => ({
  state: 'missing',
  downloaded: 0,
  total: 1000,
  error: null,
  dir: '/modelos',
  customDir: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  useModelStore.setState({ status: null, errorCode: null, movingDir: false });
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

  it('chooseDir manda el título al selector, guarda el estado nuevo y marca que está moviendo', async () => {
    let finish: (value: ModelStatus | null) => void = () => {};
    mocked.sttModelChooseDir.mockImplementation(() => new Promise((resolve) => (finish = resolve)));

    const pending = useModelStore.getState().chooseDir('Elige');
    expect(useModelStore.getState().movingDir).toBe(true);
    finish(status({ state: 'ready', dir: '/otra', customDir: true }));
    await pending;

    expect(mocked.sttModelChooseDir).toHaveBeenCalledWith('Elige');
    expect(useModelStore.getState().movingDir).toBe(false);
    expect(useModelStore.getState().status).toMatchObject({ dir: '/otra', customDir: true });
  });

  it('chooseDir sin elegir carpeta (cancelado) deja todo como estaba', async () => {
    useModelStore.setState({ status: status({ state: 'ready' }) });
    mocked.sttModelChooseDir.mockResolvedValue(null);
    await useModelStore.getState().chooseDir('Elige');
    expect(useModelStore.getState().status?.dir).toBe('/modelos');
    expect(useModelStore.getState().movingDir).toBe(false);
  });

  it('un fallo al mover guarda su código y deja de marcar que mueve', async () => {
    mocked.sttModelChooseDir.mockRejectedValue({ code: 'stt.model.busy', message: 'x' });
    await useModelStore.getState().chooseDir('Elige');
    expect(useModelStore.getState().errorCode).toBe('stt.model.busy');
    expect(useModelStore.getState().movingDir).toBe(false);
  });

  it('resetDir vuelve a la carpeta de la app', async () => {
    mocked.sttModelResetDir.mockResolvedValue(status({ state: 'ready', customDir: false }));
    await useModelStore.getState().resetDir();
    expect(useModelStore.getState().status?.customDir).toBe(false);

    mocked.sttModelResetDir.mockRejectedValue({ code: 'stt.model.disk', message: 'x' });
    await useModelStore.getState().resetDir();
    expect(useModelStore.getState().errorCode).toBe('stt.model.disk');
  });
});
