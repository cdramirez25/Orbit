import { useT } from '@/i18n/useT';
import { sttErrorKey } from '@/lib/audio/stt-error';
import { useAudioStore } from '@/stores/audio.store';
import { useTranscriptStore } from '@/stores/transcript.store';

/** Lo que se va diciendo: las frases terminadas en claro y la que está en curso, más tenue. */
export function Transcript() {
  const t = useT();
  const lines = useTranscriptStore((s) => s.lines);
  const partial = useTranscriptStore((s) => s.partial);
  const errorCode = useAudioStore((s) => s.errorCode);
  const errorKey = errorCode ? sttErrorKey(errorCode) : null;
  const empty = lines.length === 0 && partial === '';

  return (
    <div>
      <p className="mb-1 pr-16 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
        {t('transcript.title')}
      </p>
      {errorKey && <p className="mb-1 text-[12px] text-ink-dim">{t(errorKey)}</p>}
      {empty && !errorKey && (
        <>
          <p className="text-[13px] text-ink-faint">{t('transcript.waiting')}</p>
          <p className="mt-1 text-[11px] leading-snug text-ink-faint">{t('transcript.hint')}</p>
        </>
      )}
      <div className="flex flex-col gap-1">
        {lines.map((line) => (
          <p key={line.id} className="text-[15px] leading-snug text-ink">
            {line.text}
          </p>
        ))}
        {partial !== '' && <p className="text-[15px] leading-snug text-ink-dim">{partial}</p>}
      </div>
    </div>
  );
}
