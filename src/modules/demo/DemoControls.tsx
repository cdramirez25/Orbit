import { useEffect } from 'react';

import { Button, Tab, Toggle } from '@/components/ui';
import { HIT_TARGET_ATTR } from '@/hooks/useHitTest';
import { useLocaleStore } from '@/i18n/locale.store';
import { LOCALE_NAMES, type MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { commands } from '@/ipc/commands';
import { cn } from '@/lib/utils/cn';
import { useDemoStore } from '@/modules/demo/demo.store';
import { useAudioStore } from '@/stores/audio.store';
import { useIslandStore } from '@/stores/island.store';
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

const STATES: ReadonlyArray<{ id: IslandState; label: MessageKey }> = [
  { id: 'hidden', label: 'demo.controls.hidden' },
  { id: 'idle', label: 'demo.controls.idle' },
  { id: 'compact', label: 'demo.controls.compact' },
  { id: 'expanded', label: 'demo.controls.expanded' },
];

const POSITIONS: ReadonlyArray<{ id: IslandAnchor; label: MessageKey }> = [
  { id: 'left', label: 'demo.controls.left' },
  { id: 'center', label: 'demo.controls.center' },
  { id: 'right', label: 'demo.controls.right' },
  { id: 'free', label: 'demo.controls.free' },
];

/** Los idiomas se rotulan con su código (no se traducen: cada uno se reconoce a sí mismo). */
const LANGUAGES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: 'es', label: 'ES' },
  { id: 'en', label: 'EN' },
];

/** Panel de demo (solo en desarrollo): recorre los estados de la isla y alterna el estilo. */
export function DemoControls() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const current = useIslandStore((s) => s.snapshot.state);
  const goTo = useDemoStore((s) => s.goTo);
  const streamAnswer = useDemoStore((s) => s.streamAnswer);
  const showAlert = useDemoStore((s) => s.showDemoAlert);
  const style = useSettingsStore((s) => s.islandStyle);
  const setStyle = useSettingsStore((s) => s.setIslandStyle);
  const anchor = useSettingsStore((s) => s.anchor);
  const setAnchor = useSettingsStore((s) => s.setAnchor);
  const hideFromShare = useSettingsStore((s) => s.hideFromScreenShare);
  const setHideFromShare = useSettingsStore((s) => s.setHideFromScreenShare);
  const permission = useAudioStore((s) => s.permission);
  const refreshPermission = useAudioStore((s) => s.refresh);
  const requestPermission = useAudioStore((s) => s.request);
  const openPermissionSettings = useAudioStore((s) => s.openSettings);

  useEffect(() => {
    void refreshPermission();
    const timer = setInterval(() => void refreshPermission(), PERMISSION_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshPermission]);

  const hitTarget = { [HIT_TARGET_ATTR]: '' };

  return (
    <div
      {...hitTarget}
      className="fixed bottom-2 left-1/2 flex -translate-x-1/2 flex-col gap-2 rounded-2xl bg-neutral-900/95 px-3 py-2.5 ring-1 ring-white/10"
    >
      <div className="flex items-center gap-1.5">
        <div
          className="flex items-center gap-1.5"
          role="tablist"
          aria-label={t('demo.controls.stateAria')}
        >
          {STATES.map(({ id, label }) => (
            <Tab key={id} selected={current === id} onClick={() => goTo(id)}>
              {t(label)}
            </Tab>
          ))}
          <Tab selected={current === 'alert'} onClick={showAlert}>
            {t('demo.controls.alert')}
          </Tab>
        </div>

        <div
          className="ml-auto flex items-center gap-1"
          role="tablist"
          aria-label={t('demo.controls.languageAria')}
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
      </div>

      <div className="flex items-center gap-1.5">
        <div
          className="flex items-center gap-1"
          role="tablist"
          aria-label={t('demo.controls.styleAria')}
        >
          <Tab selected={style === 'attached'} onClick={() => setStyle('attached')}>
            {t('demo.controls.attached')}
          </Tab>
          <Tab selected={style === 'floating'} onClick={() => setStyle('floating')}>
            {t('demo.controls.floating')}
          </Tab>
        </div>
        <Button size="sm" variant="primary" onClick={streamAnswer}>
          {t('demo.controls.simulate')}
        </Button>
        <label className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-ink-dim">
          <Toggle
            label={t('demo.controls.hideFromShareAria')}
            checked={hideFromShare}
            onCheckedChange={setHideFromShare}
          />
          {t('demo.controls.hideFromShare')}
        </label>
        <Button size="sm" variant="danger" onClick={() => void commands.quitApp()}>
          {t('demo.controls.quit')}
        </Button>
      </div>

      <div
        className="flex items-center gap-1.5"
        role="tablist"
        aria-label={t('demo.controls.positionAria')}
      >
        <span className="text-[11px] text-ink-faint">{t('demo.controls.position')}</span>
        {POSITIONS.map(({ id, label }) => (
          <Tab key={id} selected={anchor === id} onClick={() => void setAnchor(id)}>
            {t(label)}
          </Tab>
        ))}
        {anchor === 'free' && (
          <span className="text-[11px] whitespace-nowrap text-ink-faint">
            {t('demo.controls.freeHint')}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5" role="group" aria-label={t('demo.controls.audio')}>
        <span className="text-[11px] text-ink-faint">{t('demo.controls.audio')}</span>
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
        {permission === 'notDetermined' && (
          <Button size="sm" variant="primary" onClick={() => void requestPermission()}>
            {t('audio.permission.request')}
          </Button>
        )}
        {permission === 'denied' && (
          <>
            <Button size="sm" variant="primary" onClick={() => void openPermissionSettings()}>
              {t('audio.permission.openSettings')}
            </Button>
            <span className="text-[11px] whitespace-nowrap text-ink-faint">
              {t('audio.permission.restartHint')}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
