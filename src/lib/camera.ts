import type { CameraErrorKind } from '@/types';

/** Lado máximo de la foto (px): más no hace falta y pesa mucho. */
const MAX_PHOTO_SIDE = 720;

/** Traduce el error de `getUserMedia` a algo que la interfaz sepa explicar. */
export function cameraErrorKind(error: unknown): CameraErrorKind {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return 'notFound';
    case 'NotReadableError':
    case 'AbortError':
    case 'TrackStartError':
      return 'busy';
    default:
      return 'unknown';
  }
}

/**
 * Congela el cuadro actual del video como un PNG cuadrado (recortado del centro, sin espejo: la
 * foto sale como te ve la gente, no como te ves en el espejo). `null` si el video todavía no tiene
 * imagen o el navegador no puede dibujarla.
 */
export function captureSquare(video: HTMLVideoElement): string | null {
  const { videoWidth, videoHeight } = video;
  if (videoWidth === 0 || videoHeight === 0) return null;

  const side = Math.min(videoWidth, videoHeight);
  const size = Math.min(side, MAX_PHOTO_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(
    video,
    (videoWidth - side) / 2,
    (videoHeight - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  return canvas.toDataURL('image/png');
}

/** `data:image/png;base64,AAAA` → `AAAA` (lo que espera Rust). */
export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
