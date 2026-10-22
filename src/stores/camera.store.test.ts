import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/ipc/commands';
import type * as cameraLib from '@/lib/camera';
import { captureSquare } from '@/lib/camera';
import { useCameraStore } from '@/stores/camera.store';

vi.mock('@/ipc/commands', () => ({
  commands: {
    copyCameraPhoto: vi.fn(),
    saveCameraPhoto: vi.fn(),
    openCameraSettings: vi.fn(),
  },
}));

vi.mock('@/lib/camera', async (importOriginal) => ({
  ...(await importOriginal<typeof cameraLib>()),
  captureSquare: vi.fn(),
}));

const mocked = vi.mocked(commands);
const mockedCapture = vi.mocked(captureSquare);

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

const getUserMedia = vi.fn();
const PHOTO = 'data:image/png;base64,AAAA';
const video = document.createElement('video');

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  useCameraStore.setState({
    status: 'off',
    stream: null,
    errorKind: null,
    photo: null,
    photoError: null,
  });
  mocked.copyCameraPhoto.mockResolvedValue();
  mocked.saveCameraPhoto.mockResolvedValue('Orbit-1.png');
  mocked.openCameraSettings.mockResolvedValue();
  mockedCapture.mockReturnValue(PHOTO);
});

afterEach(() => {
  useCameraStore.getState().reset();
});

describe('cámara', () => {
  it('empieza apagada', () => {
    expect(useCameraStore.getState().status).toBe('off');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('encender pide solo video (nunca audio), de la cámara frontal', async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);

    const pending = useCameraStore.getState().start();
    expect(useCameraStore.getState().status).toBe('starting');
    await pending;

    expect(useCameraStore.getState().status).toBe('on');
    expect(useCameraStore.getState().stream).toBe(stream);
    const constraints = getUserMedia.mock.calls[0]?.[0] as MediaStreamConstraints;
    expect(constraints.audio).toBe(false);
    expect(constraints.video).toMatchObject({ facingMode: 'user' });
  });

  it('encender dos veces no pide dos cámaras', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    await useCameraStore.getState().start();
    await useCameraStore.getState().start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('un permiso negado se explica como tal', async () => {
    getUserMedia.mockRejectedValue(new DOMException('x', 'NotAllowedError'));
    await useCameraStore.getState().start();
    expect(useCameraStore.getState()).toMatchObject({
      status: 'error',
      errorKind: 'denied',
      stream: null,
    });
  });

  it('sin cámara o con la cámara ocupada, también', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('x', 'NotFoundError'));
    await useCameraStore.getState().start();
    expect(useCameraStore.getState().errorKind).toBe('notFound');

    useCameraStore.getState().stop();
    getUserMedia.mockRejectedValueOnce(new DOMException('x', 'NotReadableError'));
    await useCameraStore.getState().start();
    expect(useCameraStore.getState().errorKind).toBe('busy');
  });

  it('si la ventana no ofrece cámara, lo dice sin intentarlo', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    await useCameraStore.getState().start();
    expect(useCameraStore.getState()).toMatchObject({ status: 'error', errorKind: 'unavailable' });
  });

  it('después de un fallo se puede volver a intentar', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('x', 'NotAllowedError'));
    await useCameraStore.getState().start();
    useCameraStore.getState().stop();

    getUserMedia.mockResolvedValueOnce(fakeStream().stream);
    await useCameraStore.getState().start();
    expect(useCameraStore.getState().status).toBe('on');
  });

  it('apagar para todas las pistas (la luz del equipo se apaga)', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    await useCameraStore.getState().start();

    useCameraStore.getState().stop();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(useCameraStore.getState()).toMatchObject({ status: 'off', stream: null });
  });

  it('si se apaga mientras el sistema todavía pregunta, la cámara que llega tarde se apaga sola', async () => {
    const { stream, track } = fakeStream();
    let answer: (value: MediaStream) => void = () => {};
    getUserMedia.mockImplementation(() => new Promise((resolve) => (answer = resolve)));

    const pending = useCameraStore.getState().start();
    useCameraStore.getState().stop();
    answer(stream);
    await pending;

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(useCameraStore.getState()).toMatchObject({ status: 'off', stream: null });
  });

  it('reset apaga la cámara y olvida la foto', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    await useCameraStore.getState().start();
    await useCameraStore.getState().snap(video);
    expect(useCameraStore.getState().photo).not.toBeNull();

    useCameraStore.getState().reset();

    expect(useCameraStore.getState()).toMatchObject({
      status: 'off',
      stream: null,
      photo: null,
      photoError: null,
    });
  });
});

describe('foto', () => {
  it('tomarla la muestra y la pone en el portapapeles', async () => {
    const pending = useCameraStore.getState().snap(video);
    expect(useCameraStore.getState().photo).toEqual({
      dataUrl: PHOTO,
      copied: false,
      savedAs: null,
    });
    expect(await pending).toBe(true);

    expect(mocked.copyCameraPhoto).toHaveBeenCalledWith('AAAA');
    expect(useCameraStore.getState().photo?.copied).toBe(true);
  });

  it('sin imagen en el video no hay foto', async () => {
    mockedCapture.mockReturnValue(null);
    expect(await useCameraStore.getState().snap(video)).toBe(false);
    expect(useCameraStore.getState().photo).toBeNull();
    expect(mocked.copyCameraPhoto).not.toHaveBeenCalled();
  });

  it('si no se pudo copiar, la foto se queda a la vista con el aviso', async () => {
    mocked.copyCameraPhoto.mockRejectedValue(new Error('boom'));
    await useCameraStore.getState().snap(video);
    expect(useCameraStore.getState().photo).toMatchObject({ copied: false });
    expect(useCameraStore.getState().photoError).toBe('copy');
  });

  it('guardarla manda la foto y apunta el nombre del archivo', async () => {
    await useCameraStore.getState().snap(video);
    await useCameraStore.getState().save();

    expect(mocked.saveCameraPhoto).toHaveBeenCalledWith('AAAA');
    expect(useCameraStore.getState().photo?.savedAs).toBe('Orbit-1.png');
  });

  it('si no se pudo guardar, avisa y la foto sigue ahí', async () => {
    mocked.saveCameraPhoto.mockRejectedValue(new Error('boom'));
    await useCameraStore.getState().snap(video);
    await useCameraStore.getState().save();

    expect(useCameraStore.getState().photoError).toBe('save');
    expect(useCameraStore.getState().photo?.savedAs).toBeNull();
  });

  it('guardar sin foto no hace nada', async () => {
    await useCameraStore.getState().save();
    expect(mocked.saveCameraPhoto).not.toHaveBeenCalled();
  });

  it('descartarla la quita', async () => {
    await useCameraStore.getState().snap(video);
    useCameraStore.getState().discardPhoto();
    expect(useCameraStore.getState().photo).toBeNull();
  });

  it('apagar la cámara no tira la foto ya tomada', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    await useCameraStore.getState().start();
    await useCameraStore.getState().snap(video);
    useCameraStore.getState().stop();
    expect(useCameraStore.getState().photo).not.toBeNull();
  });
});

describe('ajustes de privacidad', () => {
  it('se abren y, si no se puede, no pasa nada', async () => {
    await useCameraStore.getState().openSettings();
    expect(mocked.openCameraSettings).toHaveBeenCalledTimes(1);

    mocked.openCameraSettings.mockRejectedValue(new Error('x'));
    await expect(useCameraStore.getState().openSettings()).resolves.toBeUndefined();
  });
});
