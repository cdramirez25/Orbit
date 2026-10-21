import type { MessageKey } from '@/i18n/messages';
import { aiErrorKey, isAiError } from '@/lib/ai/ai-error';
import { sttErrorKey } from '@/lib/audio/stt-error';

/** Mensaje para un error al grabar una pregunta (audio, transcripción o IA). */
export function questionErrorKey(code: string): MessageKey {
  if (isAiError(code)) return aiErrorKey(code);
  if (code === 'audio.permissionDenied') return 'prompter.error.permission';
  if (code === 'audio.noOutputDevice') return 'audio.error.noDevice';
  return sttErrorKey(code) ?? 'audio.error.generic';
}
