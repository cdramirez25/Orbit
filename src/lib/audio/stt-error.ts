import type { MessageKey } from '@/i18n/messages';

/** Mensaje para un error de transcripción (`stt.*`); `null` si el código es de otra cosa. */
export function sttErrorKey(code: string): MessageKey | null {
  if (code === 'stt.modelMissing') return 'stt.error.modelMissing';
  if (code === 'stt.modelLoad') return 'stt.error.modelLoad';
  if (code.startsWith('stt.')) return 'stt.error.generic';
  return null;
}

/** Mensaje para un fallo al descargar o borrar el modelo (`stt.model.*`). */
export function modelErrorKey(code: string): MessageKey {
  if (code === 'stt.model.network') return 'stt.model.error.network';
  if (code === 'stt.model.disk') return 'stt.model.error.disk';
  if (code === 'stt.model.corrupt') return 'stt.model.error.corrupt';
  if (code === 'stt.model.busy') return 'stt.model.error.busy';
  if (code === 'stt.model.notReady') return 'stt.model.error.notReady';
  return 'stt.model.error.generic';
}
