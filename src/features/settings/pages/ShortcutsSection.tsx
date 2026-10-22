import { Section } from '@/features/settings/layout';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { shortcutKeys } from '@/lib/shortcuts';
import { useShortcutStore } from '@/stores/shortcuts.store';
import type { UiAction } from '@/types';

const ACTION_LABEL: Record<UiAction, MessageKey> = {
  toggleQuestion: 'shortcuts.toggleQuestion',
  toggleIsland: 'shortcuts.toggleIsland',
};

/** Atajos globales: qué hace cada uno y su combinación (o que otra app ya la usa). */
export function ShortcutsSection() {
  const t = useT();
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  if (shortcuts.length === 0) return null;

  return (
    <Section title={t('settings.section.shortcuts')}>
      <ul className="flex flex-col gap-1.5">
        {shortcuts.map(({ action, keys, registered }) => (
          <li key={action} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="text-ink">{t(ACTION_LABEL[action])}</span>
            {registered ? (
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
            ) : (
              <span className="text-[11px] text-danger">{t('shortcuts.unavailable')}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-snug text-ink-faint">{t('shortcuts.hint')}</p>
    </Section>
  );
}
