import type { MessageKey } from '@/i18n/messages';

/** Mensaje para un error de la IA (`ai.*`); cualquier otro código cae en el genérico. */
export function aiErrorKey(code: string): MessageKey {
  switch (code) {
    case 'ai.notConfigured':
      return 'ai.error.notConfigured';
    case 'ai.missingKey':
      return 'ai.error.missingKey';
    case 'ai.missingModel':
      return 'ai.error.missingModel';
    case 'ai.unauthorized':
      return 'ai.error.unauthorized';
    case 'ai.network':
      return 'ai.error.network';
    case 'ai.rateLimited':
      return 'ai.error.rateLimited';
    case 'ai.provider':
      return 'ai.error.provider';
    case 'ai.badResponse':
      return 'ai.error.badResponse';
    case 'ai.keychain':
      return 'ai.error.keychain';
    default:
      return 'ai.error.generic';
  }
}

/** ¿El error viene de la IA? (los de transcripción y audio tienen su propio mensaje). */
export function isAiError(code: string): boolean {
  return code.startsWith('ai.');
}
