import { beforeEach, describe, expect, it } from 'vitest';

import { translate, useLocaleStore } from '@/i18n/locale.store';
import { en } from '@/i18n/locales/en';
import { es } from '@/i18n/locales/es';
import { DEFAULT_LOCALE, detectLocale, LOCALES, MESSAGES } from '@/i18n/messages';

describe('diccionarios', () => {
  it('español e inglés tienen exactamente las mismas claves', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });

  it.each(LOCALES)('%s: ninguna traducción está vacía', (locale) => {
    for (const [key, value] of Object.entries(MESSAGES[locale])) {
      expect(value.trim(), `${locale} → ${key}`).not.toBe('');
    }
  });

  it('en inglés no queda texto en español sin traducir (acentos, ñ, ¿ ¡)', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, `en → ${key}`).not.toMatch(/[áéíóúñ¿¡]/i);
    }
  });
});

describe('detectLocale', () => {
  it('elige el primer idioma soportado de la lista del sistema', () => {
    expect(detectLocale(['en-US'])).toBe('en');
    expect(detectLocale(['es-MX', 'en'])).toBe('es');
    expect(detectLocale(['fr-FR', 'en-GB'])).toBe('en');
  });

  it('usa el idioma base si el del sistema no está soportado o la lista está vacía', () => {
    expect(detectLocale(['fr-FR', 'de'])).toBe(DEFAULT_LOCALE);
    expect(detectLocale([])).toBe(DEFAULT_LOCALE);
  });

  it('no distingue mayúsculas ni región', () => {
    expect(detectLocale(['EN-gb'])).toBe('en');
    expect(detectLocale(['ES-ar'])).toBe('es');
  });
});

describe('translate y el idioma activo', () => {
  beforeEach(() => {
    localStorage.clear();
    useLocaleStore.setState({ locale: 'es' });
  });

  it('traduce al idioma indicado', () => {
    expect(translate('island.collapse', 'es')).toBe('Contraer');
    expect(translate('island.collapse', 'en')).toBe('Collapse');
  });

  it('sin idioma explícito usa el activo', () => {
    expect(translate('island.open')).toBe('Abrir Orbit');
    useLocaleStore.getState().setLocale('en');
    expect(translate('island.open')).toBe('Open Orbit');
  });

  it('si a un idioma le falta un texto, cae al español en vez de mostrar vacío', () => {
    const original = MESSAGES.en['island.open'];
    MESSAGES.en['island.open'] = '';
    try {
      expect(translate('island.open', 'en')).toBe(es['island.open']);
    } finally {
      MESSAGES.en['island.open'] = original;
    }
  });

  it('elegir idioma lo guarda y actualiza <html lang>', () => {
    useLocaleStore.getState().setLocale('en');
    expect(localStorage.getItem('orbit.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    useLocaleStore.getState().setLocale('es');
    expect(localStorage.getItem('orbit.locale')).toBe('es');
    expect(document.documentElement.lang).toBe('es');
  });
});
