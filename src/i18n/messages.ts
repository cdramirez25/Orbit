import { en } from '@/i18n/locales/en';
import { es, type MessageKey } from '@/i18n/locales/es';
import type { Locale } from '@/types';

export type { MessageKey };

/** Idiomas disponibles. Para añadir uno: `locales/<código>.ts`, su `Locale` en `types/i18n.ts` y aquí. */
export const LOCALES: readonly Locale[] = ['es', 'en'];

/** Idioma base y de reserva (si falta una traducción o el sistema está en otro idioma). */
export const DEFAULT_LOCALE: Locale = 'es';

/** Cada idioma escrito en sí mismo (para selectores). */
export const LOCALE_NAMES: Record<Locale, string> = { es: 'Español', en: 'English' };

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { es, en };

/** Primer idioma soportado de la lista del sistema (`navigator.languages`); si no hay, español. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    const match = LOCALES.find((locale) => locale === base);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
