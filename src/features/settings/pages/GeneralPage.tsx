import { Compass, Power } from 'lucide-react';
import { useEffect } from 'react';

import { Button, Tab, Toggle } from '@/components/ui';
import { PageHeader, Section } from '@/features/settings/layout';
import { ShortcutsSection } from '@/features/settings/pages/ShortcutsSection';
import { useLocaleStore } from '@/i18n/locale.store';
import { LOCALE_NAMES } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { useAutostartStore } from '@/stores/autostart.store';
import { useControlStore } from '@/stores/control.store';
import { useGuideStore } from '@/stores/guide.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { Locale } from '@/types';

/** Los idiomas se rotulan con su código (no se traducen: cada uno se reconoce a sí mismo). */
const LANGUAGES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: 'es', label: 'ES' },
  { id: 'en', label: 'EN' },
];

/** Idioma, privacidad y salir de la aplicación. */
export function GeneralPage() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useControlStore((s) => s.setLocale);
  const quit = useControlStore((s) => s.quit);
  const hideFromShare = useSettingsStore((s) => s.hideFromScreenShare);
  const setHideFromShare = useSettingsStore((s) => s.setHideFromScreenShare);
  const autostart = useAutostartStore((s) => s.enabled);
  const autostartFailed = useAutostartStore((s) => s.failed);
  const loadAutostart = useAutostartStore((s) => s.load);
  const setAutostart = useAutostartStore((s) => s.set);
  const showGuide = useGuideStore((s) => s.show);

  useEffect(() => {
    void loadAutostart();
  }, [loadAutostart]);

  return (
    <>
      <PageHeader title={t('settings.nav.general')} />
      <div className="flex flex-col gap-3">
        <Section title={t('settings.section.language')}>
          <div
            className="flex items-center gap-1"
            role="tablist"
            aria-label={t('settings.panel.languageAria')}
          >
            {LANGUAGES.map(({ id, label }) => (
              <Tab
                key={id}
                selected={locale === id}
                title={LOCALE_NAMES[id]}
                onClick={() => setLocale(id)}
              >
                {label}
              </Tab>
            ))}
          </div>
        </Section>

        {autostart !== null && (
          <Section title={t('settings.section.startup')}>
            <label className="flex items-center gap-2 text-[12px] text-ink">
              <Toggle
                label={t('settings.panel.autostartAria')}
                checked={autostart}
                onCheckedChange={(enabled) => void setAutostart(enabled)}
              />
              {t('settings.panel.autostart')}
            </label>
            <p className="text-[11px] leading-snug text-ink-faint">
              {t('settings.panel.autostartHint')}
            </p>
            {autostartFailed && (
              <span role="alert" className="text-[11px] text-danger">
                {t('settings.panel.autostartError')}
              </span>
            )}
          </Section>
        )}

        <ShortcutsSection />

        <Section title={t('settings.section.privacy')}>
          <label className="flex items-center gap-2 text-[12px] text-ink">
            <Toggle
              label={t('settings.panel.hideFromShareAria')}
              checked={hideFromShare}
              onCheckedChange={setHideFromShare}
            />
            {t('settings.panel.hideFromShare')}
          </label>
          <p className="text-[11px] leading-snug text-ink-faint">
            {t('settings.panel.hideFromShareHint')}
          </p>
        </Section>

        <Section title={t('settings.section.app')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={showGuide}>
              <Compass aria-hidden className="size-3" />
              {t('guide.reopen')}
            </Button>
            <Button size="sm" variant="danger" onClick={quit}>
              <Power aria-hidden className="size-3" />
              {t('settings.panel.quit')}
            </Button>
          </div>
        </Section>
      </div>
    </>
  );
}
