import { Button } from '@/components/ui';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
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

/** El estado del permiso para capturar el audio del sistema (concedido, denegado, sin pedir…). */
export function PermissionChip() {
  const t = useT();
  const permission = useAudioStore((s) => s.permission);
  if (!permission) return null;
  return (
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
  );
}

/** Los botones que hacen falta según el permiso: pedirlo o ir a Ajustes del Sistema a concederlo. */
export function PermissionActions() {
  const t = useT();
  const permission = useAudioStore((s) => s.permission);
  const requestPermission = useAudioStore((s) => s.request);
  const openPermissionSettings = useAudioStore((s) => s.openSettings);
  return (
    <>
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
    </>
  );
}
