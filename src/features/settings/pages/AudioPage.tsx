import { Button } from '@/components/ui';
import { PageHeader, Section } from '@/features/settings/layout';
import { PermissionActions, PermissionChip } from '@/features/settings/pages/PermissionControls';
import { usePermissionPolling } from '@/hooks/usePermissionPolling';
import { TranscriptionSection } from '@/features/settings/pages/TranscriptionSection';
import { useT } from '@/i18n/useT';
import { listenErrorKey } from '@/lib/audio/listen-error';
import { useAudioStore } from '@/stores/audio.store';

/** Audio del sistema: permiso para capturarlo y el botón de escuchar. */
export function AudioPage() {
  const t = useT();
  const permission = useAudioStore((s) => s.permission);
  const listening = useAudioStore((s) => s.listening);
  const errorCode = useAudioStore((s) => s.errorCode);
  const toggleListening = useAudioStore((s) => s.toggleListening);
  const errorMessage = errorCode ? listenErrorKey(errorCode) : null;

  usePermissionPolling();

  return (
    <>
      <PageHeader title={t('settings.nav.audio')} />
      <div className="flex flex-col gap-3">
        <Section title={t('settings.panel.audio')}>
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={t('settings.panel.audio')}
          >
            <PermissionChip />
            <Button
              size="sm"
              variant={listening ? 'danger' : 'primary'}
              onClick={() => void toggleListening()}
            >
              {t(listening ? 'audio.stop' : 'audio.listen')}
            </Button>
            <PermissionActions />
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
        <TranscriptionSection />
      </div>
    </>
  );
}
