import { Download, Trash2, X } from 'lucide-react';

import { Button, ProgressBar, Tab } from '@/components/ui';
import { Field, Section } from '@/features/settings/layout';
import { LOCALE_NAMES, type MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { modelErrorKey } from '@/lib/audio/stt-error';
import { formatBytes, percentOf } from '@/lib/utils/bytes';
import { cn } from '@/lib/utils/cn';
import { useModelStore } from '@/stores/model.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { ModelState, SttLanguage } from '@/types';

/** Los idiomas fijos se rotulan con su código (cada uno se reconoce a sí mismo); `auto` se traduce. */
const LANGUAGES: ReadonlyArray<{ id: SttLanguage; label: string | null; title?: string }> = [
  { id: 'auto', label: null },
  { id: 'es', label: 'ES', title: LOCALE_NAMES.es },
  { id: 'en', label: 'EN', title: LOCALE_NAMES.en },
];

const STATE_LABEL: Record<ModelState, MessageKey> = {
  ready: 'stt.model.ready',
  missing: 'stt.model.missing',
  downloading: 'stt.model.downloading',
};

const STATE_TONE: Record<ModelState, string> = {
  ready: 'text-accent',
  missing: 'text-ink-dim',
  downloading: 'text-ink-dim',
};

/** Transcripción: en qué idioma se habla y el modelo de voz (descargarlo o borrarlo). */
export function TranscriptionSection() {
  const t = useT();
  const language = useSettingsStore((s) => s.sttLanguage);
  const setLanguage = useSettingsStore((s) => s.setSttLanguage);
  const status = useModelStore((s) => s.status);
  const commandError = useModelStore((s) => s.errorCode);
  const download = useModelStore((s) => s.download);
  const cancel = useModelStore((s) => s.cancel);
  const remove = useModelStore((s) => s.remove);

  const errorCode = commandError ?? status?.error ?? null;
  const percent = status ? percentOf(status.downloaded, status.total) : 0;

  return (
    <Section title={t('stt.section')}>
      <Field label={t('stt.language.label')}>
        <div className="flex items-center gap-1" role="tablist" aria-label={t('stt.language.aria')}>
          {LANGUAGES.map(({ id, label, title }) => (
            <Tab
              key={id}
              selected={language === id}
              title={title}
              onClick={() => void setLanguage(id)}
            >
              {label ?? t('stt.language.auto')}
            </Tab>
          ))}
        </div>
      </Field>
      <p className="text-[11px] leading-snug text-ink-faint">{t('stt.language.hint')}</p>

      {status && (
        <Field label={t('stt.model.title')}>
          <span
            role="status"
            className={cn(
              'inline-flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-medium',
              STATE_TONE[status.state],
            )}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {t(STATE_LABEL[status.state])}
          </span>
          <span className="text-[11px] text-ink-faint">{formatBytes(status.total)}</span>
          {status.state === 'missing' && (
            <Button size="sm" variant="primary" onClick={() => void download()}>
              <Download aria-hidden className="size-3" />
              {t('stt.model.download')}
            </Button>
          )}
          {status.state === 'downloading' && (
            <Button size="sm" onClick={() => void cancel()}>
              <X aria-hidden className="size-3" />
              {t('stt.model.cancel')}
            </Button>
          )}
          {status.state === 'ready' && (
            <Button size="sm" variant="danger" onClick={() => void remove()}>
              <Trash2 aria-hidden className="size-3" />
              {t('stt.model.remove')}
            </Button>
          )}
        </Field>
      )}

      {status?.state === 'downloading' && (
        <div className="flex flex-col gap-1">
          <ProgressBar value={percent} label={t('stt.model.progress')} />
          <span className="text-[11px] text-ink-faint tabular-nums">
            {percent} % · {formatBytes(status.downloaded)} / {formatBytes(status.total)}
          </span>
        </div>
      )}

      {errorCode && (
        <span role="alert" className="text-[11px] text-danger">
          {t(modelErrorKey(errorCode))}
        </span>
      )}
      <p className="text-[11px] leading-snug text-ink-faint">{t('stt.model.hint')}</p>
    </Section>
  );
}
