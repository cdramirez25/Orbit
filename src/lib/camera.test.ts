import { afterEach, describe, expect, it, vi } from 'vitest';

import { cameraErrorKind, captureSquare, dataUrlToBase64 } from '@/lib/camera';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cameraErrorKind', () => {
  it('distingue permiso negado, sin cámara, cámara ocupada y lo demás', () => {
    expect(cameraErrorKind(new DOMException('x', 'NotAllowedError'))).toBe('denied');
    expect(cameraErrorKind(new DOMException('x', 'SecurityError'))).toBe('denied');
    expect(cameraErrorKind(new DOMException('x', 'NotFoundError'))).toBe('notFound');
    expect(cameraErrorKind(new DOMException('x', 'OverconstrainedError'))).toBe('notFound');
    expect(cameraErrorKind(new DOMException('x', 'NotReadableError'))).toBe('busy');
    expect(cameraErrorKind(new DOMException('x', 'AbortError'))).toBe('busy');
    expect(cameraErrorKind(new DOMException('x', 'OtraCosa'))).toBe('unknown');
    expect(cameraErrorKind(new Error('boom'))).toBe('unknown');
    expect(cameraErrorKind('texto')).toBe('unknown');
    expect(cameraErrorKind(null)).toBe('unknown');
  });
});

describe('captureSquare', () => {
  function fakeVideo(width: number, height: number): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: width });
    Object.defineProperty(video, 'videoHeight', { value: height });
    return video;
  }

  function fakeCanvas() {
    const context = { drawImage: vi.fn(), scale: vi.fn(), translate: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,AAAA',
    );
    return context;
  }

  it('si el video todavía no tiene imagen no hay foto', () => {
    fakeCanvas();
    expect(captureSquare(fakeVideo(0, 0))).toBeNull();
  });

  it('recorta un cuadrado del centro de un video horizontal, sin espejo', () => {
    const context = fakeCanvas();

    expect(captureSquare(fakeVideo(1280, 720))).toBe('data:image/png;base64,AAAA');

    // Cuadrado de 720 centrado: empieza a 280 px del borde izquierdo y se dibuja tal cual.
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      280,
      0,
      720,
      720,
      0,
      0,
      720,
      720,
    );
    expect(context.scale).not.toHaveBeenCalled();
  });

  it('recorta del centro un video vertical y limita el tamaño de la foto', () => {
    const context = fakeCanvas();
    captureSquare(fakeVideo(1080, 1920));
    // Lado 1080 recortado desde y = 420, pero la foto sale de 720 px como máximo.
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      420,
      1080,
      1080,
      0,
      0,
      720,
      720,
    );
  });

  it('si no se puede dibujar no hay foto', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(captureSquare(fakeVideo(640, 480))).toBeNull();
  });
});

describe('dataUrlToBase64', () => {
  it('quita el prefijo y deja lo que espera Rust', () => {
    expect(dataUrlToBase64('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
  });
});
