import { useEffect } from 'react';

import { Button } from '@/components/ui';
import { PageHeader, Section } from '@/features/settings/layout';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { sttErrorKey } from '@/lib/audio/stt-error';
import { cn } from '@/lib/utils/cn';
import { useAudioStore } from '@/stores/audio.store';
import type { PermissionStatus } from '@/types';

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
  return sttErrorKey(code) ?? 'audio.error.generic';
}

/** Audio del sistema: permiso para capturarlo y el botón de escuchar. */
export function AudioPage() {
  const t = useT();
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
    <>
      <PageHeader title={t('settings.nav.audio')} />
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
        <p className="text-[11px] leading-snug text-ink-faint">{t('audio.hint')}</p>
        {errorMessage && (
          <span role="alert" className="text-[11px] text-danger">
            {t(errorMessage)}
          </span>
        )}
        {permission === 'denied' && (
          <span className="text-[11px] text-ink-faint">{t('audio.permission.restartHint')}</span>
        )}
      </Section>
    </>
  );
}
