import { useT } from '@/i18n/useT';

/** Marcador de la ventana de ajustes; el contenido real llega en la Fase 5. */
export function SettingsPlaceholder() {
  const t = useT();
  return <p className="p-6 text-sm">{t('settings.placeholder')}</p>;
}
