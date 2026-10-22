import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { useModelStore } from '@/stores/model.store';
import { modelStatus } from '@/test/factories';
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
    sttModelUse: vi.fn(),
    sttModelChooseDir: vi.fn(),
    sttModelResetDir: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  useModelStore.setState({ status: null, errorCode: null, movingDir: false });
});

describe('modelos de transcripción', () => {
  it('al enlazar pide el estado y sigue los cambios que avisa Rust', async () => {
    mocked.sttModelStatus.mockResolvedValue(modelStatus());
    await useModelStore.getState().bind();
    expect(useModelStore.getState().status).toEqual(modelStatus());

    handlers.get('stt:model')?.(
      modelStatus({ entries: { medium: { state: 'downloading', downloaded: 400 } } }),
    );
    expect(useModelStore.getState().status?.models[2]).toMatchObject({
      model: 'medium',
      state: 'downloading',
      downloaded: 400,
    });

    handlers.get('stt:model')?.(
      modelStatus({ active: 'medium', entries: { medium: { state: 'ready' } } }),
    );
    expect(useModelStore.getState().status?.active).toBe('medium');
  });

  it('si no se puede consultar el estado, se queda sin él', async () => {
    mocked.sttModelStatus.mockRejectedValue(new Error('sin respuesta'));
    await useModelStore.getState().bind();
    expect(useModelStore.getState().status).toBeNull();
  });

  it('descargar pide a Rust ese modelo y limpia el error anterior', async () => {
    useModelStore.setState({ errorCode: 'stt.model.network' });
    mocked.sttModelDownload.mockResolvedValue();

    await useModelStore.getState().download('turbo');

    expect(mocked.sttModelDownload).toHaveBeenCalledWith('turbo');
    expect(useModelStore.getState().errorCode).toBeNull();
  });

  it('un fallo al empezar la descarga guarda su código', async () => {
    mocked.sttModelDownload.mockRejectedValue({ code: 'stt.model.disk', message: 'x' });
    await useModelStore.getState().download('small');
    expect(useModelStore.getState().errorCode).toBe('stt.model.disk');
  });

  it('pedir otro modelo mientras se baja uno guarda el aviso de que está ocupado', async () => {
    mocked.sttModelDownload.mockRejectedValue({ code: 'stt.model.busy', message: 'x' });
    await useModelStore.getState().download('medium');
    expect(useModelStore.getState().errorCode).toBe('stt.model.busy');
  });

  it('borrar manda el modelo y, si falla, guarda su código', async () => {
    mocked.sttModelRemove.mockResolvedValue();
    await useModelStore.getState().remove('base');
    expect(mocked.sttModelRemove).toHaveBeenCalledWith('base');

    mocked.sttModelRemove.mockRejectedValue({ code: 'stt.model.busy', message: 'x' });
    await useModelStore.getState().remove('base');
    expect(useModelStore.getState().errorCode).toBe('stt.model.busy');
  });

  it('usar un modelo guarda el estado que devuelve Rust', async () => {
    mocked.sttModelUse.mockResolvedValue(
      modelStatus({ active: 'base', entries: { base: { state: 'ready' } } }),
    );
    await useModelStore.getState().use('base');

    expect(mocked.sttModelUse).toHaveBeenCalledWith('base');
    expect(useModelStore.getState().status?.active).toBe('base');
  });

  it('usar un modelo sin descargar guarda su código y no cambia el estado', async () => {
    useModelStore.setState({ status: modelStatus() });
    mocked.sttModelUse.mockRejectedValue({ code: 'stt.model.notReady', message: 'x' });

    await useModelStore.getState().use('medium');

    expect(useModelStore.getState().errorCode).toBe('stt.model.notReady');
    expect(useModelStore.getState().status?.active).toBe('small');
  });

  it('cancelar se lo pide a Rust y no falla si Rust no contesta', async () => {
    mocked.sttModelCancel.mockRejectedValue(new Error('x'));
    await expect(useModelStore.getState().cancel()).resolves.toBeUndefined();
    expect(mocked.sttModelCancel).toHaveBeenCalledTimes(1);
  });

  it('un estado nuevo borra el error de la orden anterior', async () => {
    mocked.sttModelStatus.mockResolvedValue(modelStatus());
    await useModelStore.getState().bind();
    useModelStore.setState({ errorCode: 'stt.model.busy' });

    handlers.get('stt:model')?.(modelStatus({ entries: { small: { state: 'ready' } } }));

    expect(useModelStore.getState().errorCode).toBeNull();
  });

  it('chooseDir manda el título al selector, guarda el estado nuevo y marca que está moviendo', async () => {
    let finish: (value: ModelStatus | null) => void = () => {};
    mocked.sttModelChooseDir.mockImplementation(() => new Promise((resolve) => (finish = resolve)));

    const pending = useModelStore.getState().chooseDir('Elige');
    expect(useModelStore.getState().movingDir).toBe(true);
    finish(modelStatus({ dir: '/otra', customDir: true }));
    await pending;

    expect(mocked.sttModelChooseDir).toHaveBeenCalledWith('Elige');
    expect(useModelStore.getState().movingDir).toBe(false);
    expect(useModelStore.getState().status).toMatchObject({ dir: '/otra', customDir: true });
  });

  it('chooseDir sin elegir carpeta (cancelado) deja todo como estaba', async () => {
    useModelStore.setState({ status: modelStatus({ dir: '/modelos' }) });
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
    mocked.sttModelResetDir.mockResolvedValue(modelStatus({ customDir: false }));
    await useModelStore.getState().resetDir();
    expect(useModelStore.getState().status?.customDir).toBe(false);

    mocked.sttModelResetDir.mockRejectedValue({ code: 'stt.model.disk', message: 'x' });
    await useModelStore.getState().resetDir();
    expect(useModelStore.getState().errorCode).toBe('stt.model.disk');
  });
});
