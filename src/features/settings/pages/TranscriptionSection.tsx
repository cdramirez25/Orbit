import { Check, Download, FolderOpen, Trash2, X } from 'lucide-react';

import { Button, IconButton, ProgressBar, Tab } from '@/components/ui';
import { Field, Section } from '@/features/settings/layout';
import { LOCALE_NAMES, type MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { modelErrorKey } from '@/lib/audio/stt-error';
import { RECOMMENDED_MODEL, STT_MODELS, isDownloading } from '@/lib/audio/stt-models';
import { formatBytes, percentOf } from '@/lib/utils/bytes';
import { cn } from '@/lib/utils/cn';
import { useModelStore } from '@/stores/model.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { ModelEntry, SttLanguage, SttModel } from '@/types';

/** Los idiomas fijos se rotulan con su código (cada uno se reconoce a sí mismo); `auto` se traduce. */
const LANGUAGES: ReadonlyArray<{ id: SttLanguage; label: string | null; title?: string }> = [
  { id: 'auto', label: null },
  { id: 'es', label: 'ES', title: LOCALE_NAMES.es },
  { id: 'en', label: 'EN', title: LOCALE_NAMES.en },
];

const MODEL_NAME: Record<SttModel, MessageKey> = {
  base: 'stt.model.name.base',
  small: 'stt.model.name.small',
  medium: 'stt.model.name.medium',
  turbo: 'stt.model.name.turbo',
};

const MODEL_DESCRIPTION: Record<SttModel, MessageKey> = {
  base: 'stt.model.desc.base',
  small: 'stt.model.desc.small',
  medium: 'stt.model.desc.medium',
  turbo: 'stt.model.desc.turbo',
};

function Chip({ tone, children }: { tone: 'accent' | 'dim'; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-medium',
        tone === 'accent' ? 'text-accent' : 'text-ink-dim',
      )}
    >
      {children}
    </span>
  );
}

/** Un modelo de voz: qué es, cuánto pesa y lo que se puede hacer con él (bajarlo, usarlo, borrarlo). */
function ModelRow({
  entry,
  active,
  locked,
}: {
  entry: ModelEntry;
  active: boolean;
  /** No se puede empezar nada: ya se baja otro modelo o se están moviendo los archivos. */
  locked: boolean;
}) {
  const t = useT();
  const download = useModelStore((s) => s.download);
  const cancel = useModelStore((s) => s.cancel);
  const remove = useModelStore((s) => s.remove);
  const use = useModelStore((s) => s.use);

  const name = t(MODEL_NAME[entry.model]);
  const percent = percentOf(entry.downloaded, entry.total);

  return (
    <li
      aria-label={name}
      className={cn(
        'flex flex-col gap-1.5 rounded-xl bg-white/6 px-3 py-2',
        active && entry.state === 'ready' && 'ring-1 ring-accent/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-ink">
            {name}
            {entry.model === RECOMMENDED_MODEL && (
              <Chip tone="dim">{t('stt.model.recommended')}</Chip>
            )}
            {entry.state === 'ready' &&
              (active ? (
                <Chip tone="accent">{t('stt.model.inUse')}</Chip>
              ) : (
                <Chip tone="dim">{t('stt.model.ready')}</Chip>
              ))}
          </span>
          <span className="text-[11px] leading-snug text-ink-faint">
            {formatBytes(entry.total)} · {t(MODEL_DESCRIPTION[entry.model])}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {entry.state === 'missing' && (
            <Button
              size="sm"
              variant={active ? 'primary' : 'secondary'}
              disabled={locked}
              aria-label={`${t('stt.model.download')} ${name}`}
              onClick={() => void download(entry.model)}
            >
              <Download aria-hidden className="size-3" />
              {t('stt.model.download')}
            </Button>
          )}
          {entry.state === 'downloading' && (
            <Button
              size="sm"
              aria-label={`${t('stt.model.cancel')} ${name}`}
              onClick={() => void cancel()}
            >
              <X aria-hidden className="size-3" />
              {t('stt.model.cancel')}
            </Button>
          )}
          {entry.state === 'ready' && !active && (
            <Button
              size="sm"
              disabled={locked}
              aria-label={`${t('stt.model.use')} ${name}`}
              onClick={() => void use(entry.model)}
            >
              <Check aria-hidden className="size-3" />
              {t('stt.model.use')}
            </Button>
          )}
          {entry.state === 'ready' && (
            <IconButton
              label={`${t('stt.model.remove')} ${name}`}
              disabled={locked}
              className="size-6 hover:text-danger"
              onClick={() => void remove(entry.model)}
            >
              <Trash2 aria-hidden className="size-3" />
            </IconButton>
          )}
        </div>
      </div>

      {entry.state === 'downloading' && (
        <div className="flex flex-col gap-1">
          <ProgressBar value={percent} label={`${t('stt.model.progress')} ${name}`} />
          <span className="text-[11px] text-ink-faint tabular-nums">
            {percent} % · {formatBytes(entry.downloaded)} / {formatBytes(entry.total)}
          </span>
        </div>
      )}

      {entry.error && (
        <span role="alert" className="text-[11px] text-danger">
          {t(modelErrorKey(entry.error))}
        </span>
      )}
    </li>
  );
}

/**
 * Los modelos de voz: cuál se usa, bajar, usar o borrar cada uno, la carpeta donde se guardan y los
 * avisos. Lo usan la sección de transcripción de Ajustes y la guía de primer arranque.
 */
export function ModelControls() {
  const t = useT();
  const status = useModelStore((s) => s.status);
  const commandError = useModelStore((s) => s.errorCode);
  const movingDir = useModelStore((s) => s.movingDir);
  const chooseDir = useModelStore((s) => s.chooseDir);
  const resetDir = useModelStore((s) => s.resetDir);

  const downloading = isDownloading(status);
  const locked = movingDir || downloading;
  const entries = STT_MODELS.map((model) => status?.models.find((e) => e.model === model)).filter(
    (entry): entry is ModelEntry => entry !== undefined,
  );

  return (
    <>
      {status && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-ink-dim">{t('stt.model.title')}</span>
          <ul className="flex flex-col gap-1.5">
            {entries.map((entry) => (
              <ModelRow
                key={entry.model}
                entry={entry}
                active={entry.model === status.active}
                locked={locked}
              />
            ))}
          </ul>
        </div>
      )}

      {status && (
        <Field label={t('stt.model.folder')}>
          <span
            title={status.dir}
            className="max-w-full min-w-0 truncate rounded-md bg-white/8 px-2 py-0.5 text-[11px] text-ink-dim"
          >
            {status.dir}
          </span>
          <Button
            size="sm"
            disabled={locked}
            onClick={() => void chooseDir(t('stt.model.folderPickTitle'))}
          >
            <FolderOpen aria-hidden className="size-3" />
            {t(movingDir ? 'stt.model.folderMoving' : 'stt.model.folderChange')}
          </Button>
          {status.customDir && (
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => void resetDir()}>
              {t('stt.model.folderReset')}
            </Button>
          )}
        </Field>
      )}

      {commandError && (
        <span role="alert" className="text-[11px] text-danger">
          {t(modelErrorKey(commandError))}
        </span>
      )}
      <p className="text-[11px] leading-snug text-ink-faint">{t('stt.model.hint')}</p>
      {status && (
        <p className="text-[11px] leading-snug text-ink-faint">{t('stt.model.folderHint')}</p>
      )}
    </>
  );
}

/** Transcripción: en qué idioma se habla y el modelo de voz. */
export function TranscriptionSection() {
  const t = useT();
  const language = useSettingsStore((s) => s.sttLanguage);
  const setLanguage = useSettingsStore((s) => s.setSttLanguage);

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
      <ModelControls />
    </Section>
  );
}
