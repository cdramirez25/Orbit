import { useEffect } from 'react';

import { Select } from '@/components/ui';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { useSoundOutputStore } from '@/stores/soundOutput.store';

function errorKey(code: string): MessageKey {
  switch (code) {
    case 'soundOutput.list':
      return 'soundOutput.error.list';
    case 'soundOutput.set':
      return 'soundOutput.error.set';
    case 'soundOutput.notFound':
      return 'soundOutput.error.notFound';
    default:
      return 'soundOutput.error.generic';
  }
}

/**
 * Elige por cuál salida suena el equipo (altavoces, audífonos, monitor…). Cambia la salida del
 * sistema, como en los Ajustes del sistema. Se vuelve a leer al abrirse y al volver a la ventana, por
 * si se conectaron unos audífonos.
 */
export function SoundOutputSelect() {
  const t = useT();
  const devices = useSoundOutputStore((s) => s.devices);
  const errorCode = useSoundOutputStore((s) => s.errorCode);
  const switching = useSoundOutputStore((s) => s.switching);
  const refresh = useSoundOutputStore((s) => s.refresh);
  const choose = useSoundOutputStore((s) => s.choose);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const current = devices.find((device) => device.isDefault);

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-[11px] text-ink-dim">
        <span className="shrink-0">{t('soundOutput.label')}</span>
        <Select
          aria-label={t('soundOutput.aria')}
          value={current?.id ?? ''}
          disabled={devices.length === 0 || switching}
          onChange={(event) => void choose(event.target.value)}
        >
          {current === undefined && (
            <option value="" disabled>
              {t('soundOutput.none')}
            </option>
          )}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </Select>
      </label>
      {errorCode && (
        <span role="alert" className="text-[11px] text-danger">
          {t(errorKey(errorCode))}
        </span>
      )}
    </div>
  );
}
