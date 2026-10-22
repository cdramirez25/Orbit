import type { ModelEntry, ModelStatus, SttModel } from '@/types';

/** Los modelos de voz, de menor a mayor capacidad (el orden en que se muestran). */
export const STT_MODELS: readonly SttModel[] = ['base', 'small', 'medium', 'turbo'];

/** El que se recomienda a quien no sabe cuál elegir. */
export const RECOMMENDED_MODEL: SttModel = 'small';

/** El modelo que usa el motor, si ya se conoce el estado. */
export function activeEntry(status: ModelStatus | null): ModelEntry | null {
  return status?.models.find((entry) => entry.model === status.active) ?? null;
}

/** ¿El modelo que se usa está descargado y listo para transcribir? */
export function isActiveModelReady(status: ModelStatus | null): boolean {
  return activeEntry(status)?.state === 'ready';
}

/** ¿Hay algún modelo bajándose? Se baja de uno en uno. */
export function isDownloading(status: ModelStatus | null): boolean {
  return status?.models.some((entry) => entry.state === 'downloading') ?? false;
}
