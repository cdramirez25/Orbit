import type { MessageKey } from '@/i18n/messages';

/** Mensaje para un error de transcripción (`stt.*`); `null` si el código es de otra cosa. */
export function sttErrorKey(code: string): MessageKey | null {
  if (code === 'stt.modelMissing') return 'stt.error.modelMissing';
  if (code === 'stt.modelLoad') return 'stt.error.modelLoad';
  if (code.startsWith('stt.')) return 'stt.error.generic';
  return null;
}
