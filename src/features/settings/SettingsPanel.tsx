import { Power } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

import { Button, Tab, Toggle } from '@/components/ui';
import { useLocaleStore } from '@/i18n/locale.store';
import { LOCALE_NAMES, type MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils/cn';
import { useAudioStore } from '@/stores/audio.store';
import { useControlStore } from '@/stores/control.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { IslandAnchor, IslandState, Locale, PermissionStatus } from '@/types';

const PERMISSION_LABEL: Record<PermissionStatus, MessageKey> = {
  granted: 'audio.permission.granted',
  denied: 'audio.permission.denied',
  notDetermined: 'audio.permission.notDetermined',
  notRequired: 'audio.permission.notRequired',
};

const PERMISSION_TONE: Record<PermissionStatus, string> = {
  granted: 'text-accent',
  denied: 'text-danger',
  notDetermined: 'text-ink-dim',
  notRequired: 'text-ink-dim',
};

/** Cada cuánto se vuelve a consultar el permiso (el usuario lo concede en Ajustes del Sistema). */
const PERMISSION_POLL_MS = 2000;

/** Mensaje para el error al escuchar. El de permiso ya se ve en el estado del permiso. */
function listenErrorKey(code: string): MessageKey | null {
  if (code === 'audio.permissionDenied') return null;
  if (code === 'audio.noOutputDevice') return 'audio.error.noDevice';
  return 'audio.error.generic';
}

const STATES: ReadonlyArray<{ id: IslandState; label: MessageKey }> = [
  { id: 'hidden', label: 'settings.panel.hidden' },
  { id: 'idle', label: 'settings.panel.idle' },
  { id: 'compact', label: 'settings.panel.compact' },
  { id: 'expanded', label: 'settings.panel.expanded' },
];

const POSITIONS: ReadonlyArray<{ id: IslandAnchor; label: MessageKey }> = [
  { id: 'left', label: 'settings.panel.left' },
  { id: 'center', label: 'settings.panel.center' },
  { id: 'right', label: 'settings.panel.right' },
  { id: 'free', label: 'settings.panel.free' },
];

/** Los idiomas se rotulan con su código (no se traducen: cada uno se reconoce a sí mismo). */
const LANGUAGES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: 'es', label: 'ES' },
  { id: 'en', label: 'EN' },
];

/** Bloque del panel: título pequeño y, debajo, sus controles. */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  /** Botón a la derecha del título (una acción de la sección). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-white/8 pt-2.5 first:border-t-0 first:pt-0">
      <div className="flex min-h-6 items-center justify-between">
        <h3 className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Fila con rótulo (arriba) y controles (abajo). */
function Field({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-[11px] text-ink-dim">{label}</span>}
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

/**
 * Contenido de la ventana de ajustes (solo en desarrollo): estados de la isla, apariencia, idioma,
 * privacidad y audio. La isla vive en otra ventana, así que se maneja con `useControlStore`.
 */
export function SettingsPanel() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const current = useControlStore((s) => s.islandState);
  const style = useControlStore((s) => s.style);
  const anchor = useControlStore((s) => s.anchor);
  const goTo = useControlStore((s) => s.goTo);
  const simulate = useControlStore((s) => s.simulate);
  const showAlert = useControlStore((s) => s.alert);
  const setStyle = useControlStore((s) => s.setStyle);
  const setAnchor = useControlStore((s) => s.setAnchor);
  const setLocale = useControlStore((s) => s.setLocale);
  const quit = useControlStore((s) => s.quit);
  const hideFromShare = useSettingsStore((s) => s.hideFromScreenShare);
  const setHideFromShare = useSettingsStore((s) => s.setHideFromScreenShare);
  const permission = useAudioStore((s) => s.permission);
  const refreshPermission = useAudioStore((s) => s.refresh);
  const requestPermission = useAudioStore((s) => s.request);
  const openPermissionSettings = useAudioStore((s) => s.openSettings);
  const listening = useAudioStore((s) => s.listening);
  const errorCode = useAudioStore((s) => s.errorCode);
  const toggleListening = useAudioStore((s) => s.toggleListening);
  const errorMessage = errorCode ? listenErrorKey(errorCode) : null;

  useEffect(() => {
    void refreshPermission();
    const timer = setInterval(() => void refreshPermission(), PERMISSION_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshPermission]);

  return (
    <main
      aria-label={t('settings.panel.title')}
      className="h-screen overflow-y-auto bg-neutral-900 px-5 py-4 text-ink"
    >
      <div className="grid grid-cols-[1.3fr_1fr] gap-x-6">
        <div className="flex flex-col gap-2.5">
          <Section
            title={t('settings.section.behavior')}
            action={
              <Button size="sm" variant="primary" onClick={simulate}>
                {t('settings.panel.simulate')}
              </Button>
            }
          >
            <Field label={t('settings.panel.state')}>
              <div
                className="flex flex-wrap items-center gap-1"
                role="tablist"
                aria-label={t('settings.panel.stateAria')}
              >
                {STATES.map(({ id, label }) => (
                  <Tab key={id} selected={current === id} className="px-2" onClick={() => goTo(id)}>
                    {t(label)}
                  </Tab>
                ))}
                <Tab selected={current === 'alert'} className="px-2" onClick={showAlert}>
                  {t('settings.panel.alert')}
                </Tab>
              </div>
            </Field>
          </Section>

          <Section title={t('settings.section.appearance')}>
            <Field label={t('settings.panel.position')}>
              <div
                className="flex flex-wrap items-center gap-1"
                role="tablist"
                aria-label={t('settings.panel.positionAria')}
              >
                {POSITIONS.map(({ id, label }) => (
                  <Tab key={id} selected={anchor === id} onClick={() => setAnchor(id)}>
                    {t(label)}
                  </Tab>
                ))}
              </div>
              {anchor === 'free' && (
                <span className="text-[11px] text-ink-faint">{t('settings.panel.freeHint')}</span>
              )}
            </Field>
            <Field label={t('settings.panel.style')}>
              <div
                className="flex items-center gap-1"
                role="tablist"
                aria-label={t('settings.panel.styleAria')}
              >
                <Tab selected={style === 'attached'} onClick={() => setStyle('attached')}>
                  {t('settings.panel.attached')}
                </Tab>
                <Tab selected={style === 'floating'} onClick={() => setStyle('floating')}>
                  {t('settings.panel.floating')}
                </Tab>
              </div>
            </Field>
          </Section>
        </div>

        <div className="flex flex-col gap-2.5">
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

          <Section title={t('settings.panel.audio')}>
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label={t('settings.panel.audio')}
            >
              {permission && (
                <span
                  role="status"
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-medium',
                    PERMISSION_TONE[permission],
                  )}
                >
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                  {t(PERMISSION_LABEL[permission])}
                </span>
              )}
              <Button
                size="sm"
                variant={listening ? 'danger' : 'primary'}
                onClick={() => void toggleListening()}
              >
                {t(listening ? 'audio.stop' : 'audio.listen')}
              </Button>
              {permission === 'notDetermined' && (
                <Button size="sm" variant="primary" onClick={() => void requestPermission()}>
                  {t('audio.permission.request')}
                </Button>
              )}
              {permission === 'denied' && (
                <Button size="sm" variant="primary" onClick={() => void openPermissionSettings()}>
                  {t('audio.permission.openSettings')}
                </Button>
              )}
            </div>
            {errorMessage && (
              <span role="alert" className="text-[11px] text-danger">
                {t(errorMessage)}
              </span>
            )}
            {permission === 'denied' && (
              <span className="text-[11px] text-ink-faint">
                {t('audio.permission.restartHint')}
              </span>
            )}
          </Section>

          <Section title={t('settings.section.app')}>
            <div>
              <Button size="sm" variant="danger" onClick={quit}>
                <Power aria-hidden className="size-3" />
                {t('settings.panel.quit')}
              </Button>
            </div>
          </Section>
        </div>
      </div>
    </main>
  );
}
