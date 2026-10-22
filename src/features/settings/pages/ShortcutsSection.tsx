import { useEffect, useState } from 'react';

import { Button } from '@/components/ui';
import { Section } from '@/features/settings/layout';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { shortcutFromEvent, shortcutKeys } from '@/lib/shortcuts';
import { cn } from '@/lib/utils/cn';
import { useShortcutStore } from '@/stores/shortcuts.store';
import type { UiAction } from '@/types';

const ACTION_LABEL: Record<UiAction, MessageKey> = {
  toggleQuestion: 'shortcuts.toggleQuestion',
  toggleIsland: 'shortcuts.toggleIsland',
};

function errorKey(code: string): MessageKey {
  switch (code) {
    case 'shortcut.invalid':
      return 'shortcuts.error.invalid';
    case 'shortcut.needsModifier':
      return 'shortcuts.error.needsModifier';
    case 'shortcut.duplicate':
      return 'shortcuts.error.duplicate';
    case 'shortcut.unavailable':
      return 'shortcuts.error.unavailable';
    default:
      return 'shortcuts.error.generic';
  }
}

/** Las teclas de un atajo, una por cuadro. */
export function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex items-center gap-1">
      {shortcutKeys(keys).map((key) => (
        <kbd
          key={key}
          className="rounded-md bg-white/10 px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink-dim"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Mientras `active`, la próxima combinación que se pulse sale por `onCapture`. Escape cancela. El
 * evento se detiene: pulsar Cmd+W para elegirlo no debe cerrar la ventana.
 */
function useCapture(active: boolean, onCapture: (keys: string) => void, onCancel: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        onCancel();
        return;
      }
      const keys = shortcutFromEvent(event);
      if (keys !== null) onCapture(keys);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, onCapture, onCancel]);
}

/** Atajos globales: cada uno con sus teclas, cambiarlo, restablecerlo o ver que otra app lo usa. */
export function ShortcutsSection() {
  const t = useT();
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const error = useShortcutStore((s) => s.error);
  const change = useShortcutStore((s) => s.change);
  const reset = useShortcutStore((s) => s.reset);
  const clearError = useShortcutStore((s) => s.clearError);
  const [capturing, setCapturing] = useState<UiAction | null>(null);

  useCapture(
    capturing !== null,
    (keys) => {
      const action = capturing;
      setCapturing(null);
      if (action !== null) void change(action, keys);
    },
    () => setCapturing(null),
  );

  if (shortcuts.length === 0) return null;

  return (
    <Section title={t('settings.section.shortcuts')}>
      <ul className="flex flex-col gap-2">
        {shortcuts.map(({ action, keys, defaultKeys, registered }) => {
          const mine = error?.action === action ? error : null;
          const waiting = capturing === action;
          return (
            <li key={action} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="text-ink">{t(ACTION_LABEL[action])}</span>
                <span className="flex items-center gap-2">
                  {waiting ? (
                    <span
                      role="status"
                      className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent"
                    >
                      {t('shortcuts.capture')}
                    </span>
                  ) : registered ? (
                    <Keys keys={keys} />
                  ) : (
                    <span className="text-[11px] text-danger">{t('shortcuts.unavailable')}</span>
                  )}
                  <Button
                    size="sm"
                    variant={waiting ? 'danger' : 'secondary'}
                    onClick={() => {
                      clearError();
                      setCapturing(waiting ? null : action);
                    }}
                  >
                    {t(waiting ? 'shortcuts.cancel' : 'shortcuts.change')}
                  </Button>
                  {keys !== defaultKeys && !waiting && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCapturing(null);
                        void reset(action);
                      }}
                    >
                      {t('shortcuts.reset')}
                    </Button>
                  )}
                </span>
              </div>
              {mine && (
                <span role="alert" className={cn('text-[11px] text-danger')}>
                  {t(errorKey(mine.code))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] leading-snug text-ink-faint">
        {t(capturing ? 'shortcuts.captureHint' : 'shortcuts.hint')}
      </p>
    </Section>
  );
}
