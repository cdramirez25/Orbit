import {
  Check,
  Copy,
  FileText,
  Languages,
  Lightbulb,
  Loader2,
  Shrink,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Button, IconButton } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useLocaleStore } from '@/i18n/locale.store';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { aiErrorKey } from '@/lib/ai/ai-error';
import { formatRelativeTime } from '@/lib/utils/time';
import { useClipboardStore, type ClipboardAiResult } from '@/stores/clipboard.store';
import type { ClipboardAiAction, ClipboardEntry } from '@/types';

/** Las acciones de IA que se ofrecen sobre un texto copiado, con su icono y sus textos. */
const AI_ACTIONS: ReadonlyArray<{
  id: ClipboardAiAction;
  icon: LucideIcon;
  label: MessageKey;
  result: MessageKey;
}> = [
  {
    id: 'translate',
    icon: Languages,
    label: 'clipboard.ai.translate',
    result: 'clipboard.ai.result.translate',
  },
  {
    id: 'summarize',
    icon: Shrink,
    label: 'clipboard.ai.summarize',
    result: 'clipboard.ai.result.summarize',
  },
  {
    id: 'explain',
    icon: Lightbulb,
    label: 'clipboard.ai.explain',
    result: 'clipboard.ai.result.explain',
  },
];

/** Lo que contestó la IA a una acción sobre un texto: cargando, el resultado (copiable) o el error. */
function AiResult({ result }: { result: ClipboardAiResult }) {
  const t = useT();
  const copied = useClipboardStore((s) => s.aiResultCopied);
  const copyResult = useClipboardStore((s) => s.copyAiResult);
  const close = useClipboardStore((s) => s.closeAiResult);
  const action = AI_ACTIONS.find((item) => item.id === result.action);

  return (
    <div className="mr-1 mb-1.5 ml-2 flex flex-col gap-1.5 rounded-xl bg-white/6 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
          {action ? t(action.result) : ''}
        </span>
        <div className="flex items-center gap-0.5">
          {result.status === 'done' && result.text && (
            <IconButton
              label={t('clipboard.ai.copy')}
              className="size-6"
              onClick={() => void copyResult()}
            >
              {copied ? (
                <Check aria-hidden className="size-3.5 text-accent" />
              ) : (
                <Copy aria-hidden className="size-3.5" />
              )}
            </IconButton>
          )}
          <IconButton label={t('clipboard.ai.close')} className="size-6" onClick={close}>
            <X aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      </div>

      {result.status === 'working' && (
        <p role="status" className="flex items-center gap-2 text-[12px] text-ink-dim">
          <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          {t('clipboard.ai.working')}
        </p>
      )}
      {result.status === 'done' && (
        <p className="text-[13px] leading-snug break-words whitespace-pre-wrap text-ink select-text">
          {result.text || t('clipboard.ai.empty')}
        </p>
      )}
      {result.status === 'error' && (
        <p role="alert" className="text-[11px] text-danger">
          {t(aiErrorKey(result.errorCode ?? ''))}
        </p>
      )}
    </div>
  );
}

function Item({ entry, now, locale }: { entry: ClipboardEntry; now: number; locale: string }) {
  const t = useT();
  const copied = useClipboardStore((s) => s.copiedId === entry.id);
  const copy = useClipboardStore((s) => s.copy);
  const remove = useClipboardStore((s) => s.remove);
  const askAi = useClipboardStore((s) => s.askAi);
  const result = useClipboardStore((s) => (s.aiResult?.id === entry.id ? s.aiResult : null));

  const isImage = entry.kind === 'image';
  const detail = isImage
    ? `${entry.width ?? 0} × ${entry.height ?? 0}`
    : `${entry.charCount ?? 0} ${t('clipboard.characters')}`;

  return (
    <li className="group rounded-xl focus-within:bg-white/8 hover:bg-white/8">
      <div className="flex items-center gap-1 pr-1">
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
        <div className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          {!isImage &&
            AI_ACTIONS.map(({ id, icon: Icon, label }) => (
              <IconButton
                key={id}
                label={t(label)}
                className="size-6"
                onClick={() => void askAi(entry.id, id, locale)}
              >
                <Icon aria-hidden className="size-3.5" />
              </IconButton>
            ))}
          <IconButton
            label={t('clipboard.delete')}
            className="size-6"
            onClick={() => void remove(entry.id)}
          >
            <Trash2 aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      </div>
      {result && <AiResult result={result} />}
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
