import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import type * as cameraLib from '@/lib/camera';
import { captureSquare } from '@/lib/camera';
import { Compact } from '@/modules/camera/Compact';
import { Expanded } from '@/modules/camera/Expanded';
import { cameraModule } from '@/modules/camera';
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
const getUserMedia = vi.fn();

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

beforeAll(() => {
  // jsdom no trae `matchMedia`, que usa `useReducedMotion`.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'es' });
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
  vi.mocked(captureSquare).mockReturnValue('data:image/png;base64,AAAA');
});

describe('tarjeta de la cámara', () => {
  it('apagada: explica para qué sirve, no muestra imagen y no toca la cámara', () => {
    render(<Expanded />);
    expect(screen.getByText(/espejo para verte antes de una llamada/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Apagada');
    expect(screen.queryByLabelText('Vista previa de la cámara')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tomar foto' })).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('dice que la cámara solo está encendida con la tarjeta abierta y que nada se guarda solo', () => {
    render(<Expanded />);
    expect(
      screen.getByText(/solo está encendida mientras esta tarjeta está abierta/),
    ).toBeInTheDocument();
  });

  it('encender muestra la vista previa y los botones de foto y apagar', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    render(<Expanded />);

    fireEvent.click(screen.getByRole('button', { name: 'Encender cámara' }));
    expect(screen.getByText('Encendiendo…')).toBeInTheDocument();
    await act(async () => {});

    expect(screen.getByLabelText('Vista previa de la cámara')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Encendida');
    expect(screen.getByRole('button', { name: 'Tomar foto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apagar cámara' })).toBeInTheDocument();
  });

  it('la vista previa se ve en espejo y recibe lo que llega de la cámara', async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Encender cámara' }));
    await act(async () => {});

    const video = screen.getByLabelText('Vista previa de la cámara') as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);
    expect(video.className).toContain('scaleX(-1)');
    expect(video.muted).toBe(true);
  });

  it('apagar para la cámara y vuelve a la explicación', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Encender cámara' }));
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Apagar cámara' }));

    expect(track.stop).toHaveBeenCalled();
    expect(screen.queryByLabelText('Vista previa de la cámara')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encender cámara' })).toBeInTheDocument();
  });

  it('tomar la foto la copia, la muestra y deja guardarla o descartarla', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Encender cámara' }));
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Tomar foto' }));
    await act(async () => {});

    expect(mocked.copyCameraPhoto).toHaveBeenCalledWith('AAAA');
    expect(screen.getByRole('img', { name: 'Foto tomada' })).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    );
    expect(screen.getByText('Copiada al portapapeles')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar en Imágenes' }));
    await act(async () => {});
    expect(mocked.saveCameraPhoto).toHaveBeenCalledWith('AAAA');
    expect(screen.getByText('Guardada en Imágenes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar en Imágenes' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.queryByRole('img', { name: 'Foto tomada' })).not.toBeInTheDocument();
  });

  it('un permiso negado lo explica y manda a los ajustes de privacidad', async () => {
    getUserMedia.mockRejectedValue(new DOMException('x', 'NotAllowedError'));
    render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Encender cámara' }));
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Orbit no tiene permiso para usar la cámara.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ajustes de privacidad' }));
    expect(mocked.openCameraSettings).toHaveBeenCalledTimes(1);
    // Se puede volver a intentar.
    expect(screen.getByRole('button', { name: 'Encender cámara' })).toBeInTheDocument();
  });

  it('sin cámara no ofrece abrir los ajustes', async () => {
    getUserMedia.mockRejectedValue(new DOMException('x', 'NotFoundError'));
    render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Encender cámara' }));
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent('No se encontró ninguna cámara.');
    expect(
      screen.queryByRole('button', { name: 'Abrir ajustes de privacidad' }),
    ).not.toBeInTheDocument();
  });

  it('al cerrar la tarjeta la cámara se apaga y no queda ninguna foto', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { unmount } = render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Encender cámara' }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Tomar foto' }));
    await act(async () => {});
    expect(useCameraStore.getState().photo).not.toBeNull();

    unmount();

    expect(track.stop).toHaveBeenCalled();
    expect(useCameraStore.getState()).toMatchObject({ status: 'off', stream: null, photo: null });
  });

  it('si la ventana se oculta con la cámara encendida, se apaga', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    render(<Expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Encender cámara' }));
    await act(async () => {});

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });

    expect(track.stop).toHaveBeenCalled();
    expect(useCameraStore.getState().status).toBe('off');
  });

  it('en inglés, los textos salen en inglés', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(<Expanded />);
    expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Off');
  });
});

describe('pastilla de la cámara', () => {
  it('apagada no muestra el punto y encendida sí', () => {
    const { container, rerender } = render(<Compact />);
    expect(screen.getByText('Apagada')).toBeInTheDocument();
    expect(container.querySelectorAll('span[aria-hidden]')).toHaveLength(0);

    act(() => useCameraStore.setState({ status: 'on' }));
    rerender(<Compact />);
    expect(screen.getByText('Encendida')).toBeInTheDocument();
    expect(container.querySelectorAll('span[aria-hidden]')).toHaveLength(1);
  });

  it('es un módulo residente de la isla con su propio nombre', () => {
    expect(cameraModule.ambient).toBe(true);
    expect(cameraModule.labelKey).toBe('camera.module');
  });
});
