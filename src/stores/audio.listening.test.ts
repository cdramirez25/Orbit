import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import { onEvent } from '@/ipc/events';
import { audioLevel } from '@/lib/audio/audio-level';
import { useAudioStore } from '@/stores/audio.store';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getAudioPermission: vi.fn(),
    requestAudioPermission: vi.fn(),
    openAudioPermissionSettings: vi.fn(),
    startListening: vi.fn(),
    stopListening: vi.fn(),
    isListening: vi.fn(),
  },
}));
vi.mock('@/ipc/events', () => ({ onEvent: vi.fn() }));

const mocked = vi.mocked(commands);

beforeEach(() => {
  vi.clearAllMocks();
  audioLevel.set(0);
  useAudioStore.setState({ permission: 'granted', listening: false, errorCode: null });
  mocked.getAudioPermission.mockResolvedValue('granted');
});

describe('escuchar', () => {
  it('startListening arranca la escucha y limpia el error', async () => {
    useAudioStore.setState({ errorCode: 'audio.capture' });
    mocked.startListening.mockResolvedValue(undefined);

    await useAudioStore.getState().startListening();

    expect(mocked.startListening).toHaveBeenCalledTimes(1);
    expect(useAudioStore.getState().listening).toBe(true);
    expect(useAudioStore.getState().errorCode).toBeNull();
  });

  it('si falla guarda el código del error y vuelve a consultar el permiso', async () => {
    mocked.startListening.mockRejectedValue({
      code: 'audio.permissionDenied',
      message: 'falta el permiso',
    });
    mocked.getAudioPermission.mockResolvedValue('denied');

    await useAudioStore.getState().startListening();

    expect(useAudioStore.getState().listening).toBe(false);
    expect(useAudioStore.getState().errorCode).toBe('audio.permissionDenied');
    expect(mocked.getAudioPermission).toHaveBeenCalled();
    expect(useAudioStore.getState().permission).toBe('denied');
  });

  it('un error sin código se guarda como "unknown"', async () => {
    mocked.startListening.mockRejectedValue(new Error('algo raro'));
    await useAudioStore.getState().startListening();
    expect(useAudioStore.getState().errorCode).toBe('unknown');
  });

  it('la primera vez pide el permiso antes de escuchar', async () => {
    useAudioStore.setState({ permission: 'notDetermined' });
    mocked.requestAudioPermission.mockResolvedValue('granted');
    mocked.startListening.mockResolvedValue(undefined);

    await useAudioStore.getState().startListening();

    expect(mocked.requestAudioPermission).toHaveBeenCalledTimes(1);
    expect(mocked.requestAudioPermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.startListening.mock.invocationCallOrder[0] ?? 0,
    );
    expect(useAudioStore.getState().listening).toBe(true);
  });

  it('con el permiso ya concedido no lo vuelve a pedir', async () => {
    mocked.startListening.mockResolvedValue(undefined);
    await useAudioStore.getState().startListening();
    expect(mocked.requestAudioPermission).not.toHaveBeenCalled();
  });

  it('stopListening para, apaga "escuchando" y baja las ondas a cero', async () => {
    useAudioStore.setState({ listening: true });
    audioLevel.set(0.8);
    mocked.stopListening.mockResolvedValue(undefined);

    await useAudioStore.getState().stopListening();

    expect(mocked.stopListening).toHaveBeenCalledTimes(1);
    expect(useAudioStore.getState().listening).toBe(false);
    expect(audioLevel.get()).toBe(0);
  });

  it('aunque falle el comando de parar, la interfaz deja de mostrar "escuchando"', async () => {
    useAudioStore.setState({ listening: true });
    mocked.stopListening.mockRejectedValue(new Error('sin respuesta'));
    await useAudioStore.getState().stopListening();
    expect(useAudioStore.getState().listening).toBe(false);
  });

  it('toggleListening alterna entre escuchar y parar', async () => {
    mocked.startListening.mockResolvedValue(undefined);
    mocked.stopListening.mockResolvedValue(undefined);

    await useAudioStore.getState().toggleListening();
    expect(useAudioStore.getState().listening).toBe(true);

    await useAudioStore.getState().toggleListening();
    expect(useAudioStore.getState().listening).toBe(false);
    expect(mocked.startListening).toHaveBeenCalledTimes(1);
    expect(mocked.stopListening).toHaveBeenCalledTimes(1);
  });
});

describe('bind: eventos de Rust', () => {
  type Handler = (payload: unknown) => void;
  const handlers = new Map<string, Handler>();
  const unlisten = vi.fn();

  beforeEach(() => {
    handlers.clear();
    vi.mocked(onEvent).mockImplementation(async (name, handler) => {
      handlers.set(name, handler as unknown as Handler);
      return unlisten;
    });
    mocked.isListening.mockResolvedValue(false);
  });

  const emit = (name: string, payload: unknown) => handlers.get(name)?.(payload);

  it('se suscribe al volumen, al estado y a los errores', async () => {
    await useAudioStore.getState().bind();
    expect([...handlers.keys()].sort()).toEqual(['audio:level', 'error', 'pipeline:state']);
  });

  it('el evento de volumen mueve las ondas', async () => {
    await useAudioStore.getState().bind();
    emit('audio:level', 0.62);
    expect(audioLevel.get()).toBeCloseTo(0.62);
    emit('audio:level', 0);
    expect(audioLevel.get()).toBe(0);
  });

  it('el estado del pipeline actualiza "escuchando" y limpia el error al empezar', async () => {
    await useAudioStore.getState().bind();
    useAudioStore.setState({ errorCode: 'audio.capture' });

    emit('pipeline:state', 'listening');
    expect(useAudioStore.getState().listening).toBe(true);
    expect(useAudioStore.getState().errorCode).toBeNull();

    emit('pipeline:state', 'idle');
    expect(useAudioStore.getState().listening).toBe(false);

    emit('pipeline:state', 'listening');
    emit('pipeline:state', 'error');
    expect(useAudioStore.getState().listening).toBe(false);
  });

  it('un evento de error guarda su código', async () => {
    await useAudioStore.getState().bind();
    emit('error', { code: 'audio.captureEnded', message: 'se detuvo', recoverable: true });
    expect(useAudioStore.getState().errorCode).toBe('audio.captureEnded');
  });

  it('si ya se estaba escuchando al cargar la interfaz, lo refleja', async () => {
    mocked.isListening.mockResolvedValue(true);
    await useAudioStore.getState().bind();
    expect(useAudioStore.getState().listening).toBe(true);
  });

  it('devuelve una función que desuscribe todo', async () => {
    const stop = await useAudioStore.getState().bind();
    stop();
    expect(unlisten).toHaveBeenCalledTimes(3);
  });
});
