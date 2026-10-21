import { useCallback } from 'react';

import { translate, useLocaleStore } from '@/i18n/locale.store';
import type { MessageKey } from '@/i18n/messages';

/** Función de traducción para componentes: `const t = useT(); t('island.open')`. */
export function useT(): (key: MessageKey) => string {
  const locale = useLocaleStore((state) => state.locale);
  return useCallback((key) => translate(key, locale), [locale]);
}
