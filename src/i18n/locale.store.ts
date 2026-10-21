import { create } from 'zustand';

import { DEFAULT_LOCALE, detectLocale, LOCALES, MESSAGES, type MessageKey } from '@/i18n/messages';
import type { Locale } from '@/types';

const STORAGE_KEY = 'orbit.locale';

function savedLocale(): Locale | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return LOCALES.find((locale) => locale === saved) ?? null;
  } catch {
    return null; // sin almacenamiento (ventana privada, bloqueado…): se usa el del sistema
  }
}

function initialLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  return savedLocale() ?? detectLocale(navigator.languages ?? [navigator.language]);
}

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/** Idioma de la interfaz: lo elegido por el usuario o, si no hay, el del sistema. */
export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // No se pudo guardar: el cambio sigue valiendo durante esta sesión.
    }
    set({ locale });
  },
}));

// Accesibilidad: `<html lang>` siempre refleja el idioma activo.
function syncDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
syncDocumentLang(useLocaleStore.getState().locale);
useLocaleStore.subscribe((state) => syncDocumentLang(state.locale));

/**
 * Traduce fuera de React (stores, servicios). En componentes usa `useT()` para que se
 * vuelvan a pintar al cambiar de idioma.
 */
export function translate(
  key: MessageKey,
  locale: Locale = useLocaleStore.getState().locale,
): string {
  return MESSAGES[locale][key] || MESSAGES[DEFAULT_LOCALE][key];
}
