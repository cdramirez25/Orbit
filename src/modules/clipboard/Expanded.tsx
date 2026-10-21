import { Check, FileText, Trash2 } from 'lucide-react';

import { Button, IconButton } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useLocaleStore } from '@/i18n/locale.store';
import { useT } from '@/i18n/useT';
import { formatRelativeTime } from '@/lib/utils/time';
import { useClipboardStore } from '@/stores/clipboard.store';
import type { ClipboardEntry } from '@/types';

function Item({ entry, now, locale }: { entry: ClipboardEntry; now: number; locale: string }) {
  const t = useT();
  const copied = useClipboardStore((s) => s.copiedId === entry.id);
  const copy = useClipboardStore((s) => s.copy);
  const remove = useClipboardStore((s) => s.remove);

  const isImage = entry.kind === 'image';
  const detail = isImage
    ? `${entry.width ?? 0} × ${entry.height ?? 0}`
    : `${entry.charCount ?? 0} ${t('clipboard.characters')}`;

  return (
    <li className="group flex items-center gap-1 rounded-xl pr-1 focus-within:bg-white/8 hover:bg-white/8">
      <button
        type="button"
        title={t('clipboard.copy')}
        onClick={() => void copy(entry.id)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/8">
          {isImage && entry.thumbnail ? (
            <img
              src={entry.thumbnail}
              alt={t('clipboard.imageAlt')}
              className="size-full object-cover"
            />
          ) : (
            <FileText aria-hidden className="size-4 text-ink-dim" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-[13px] leading-snug break-words text-ink">
            {isImage ? t('clipboard.image') : entry.text}
          </span>
          <span className="block truncate text-[11px] text-ink-faint">
            {formatRelativeTime(entry.copiedAtMs, now, locale)} · {detail}
          </span>
        </span>
        {copied && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent">
            <Check aria-hidden className="size-3.5" />
            {t('clipboard.copied')}
          </span>
        )}
      </button>
      <IconButton
        label={t('clipboard.delete')}
        className="shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={() => void remove(entry.id)}
      >
        <Trash2 aria-hidden className="size-3.5" />
      </IconButton>
    </li>
  );
}

/** Historial de lo copiado en esta sesión (texto e imágenes), con borrado por elemento y total. */
export function Expanded() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const now = useNow();
  const entries = useClipboardStore((s) => s.entries);
  const clear = useClipboardStore((s) => s.clear);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">
          {t('clipboard.title')} · {entries.length}
        </p>
        {entries.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('clipboard.clearAria')}
            onClick={() => void clear()}
          >
            <Trash2 aria-hidden className="size-3" />
            {t('clipboard.clear')}
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="py-3 text-[13px] text-ink-dim">{t('clipboard.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {entries.map((entry) => (
            <Item key={entry.id} entry={entry} now={now} locale={locale} />
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-ink-faint">{t('clipboard.sessionHint')}</p>
    </div>
  );
}
