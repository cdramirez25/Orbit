import type { MessageKey } from '@/i18n/messages';
import { sttErrorKey } from '@/lib/audio/stt-error';

/**
 * Mensaje para el error al escuchar. El del permiso solo se explica donde no se ve ya el estado del
 * permiso (la pantalla de transcripción de la isla); en Ajustes ese estado está a la vista.
 */
export function listenErrorKey(code: string, explainPermission = false): MessageKey | null {
  if (code === 'audio.permissionDenied')
    return explainPermission ? 'listen.error.permission' : null;
  if (code === 'audio.noOutputDevice') return 'audio.error.noDevice';
  return sttErrorKey(code) ?? 'audio.error.generic';
}
