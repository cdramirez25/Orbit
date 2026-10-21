import { useT } from '@/i18n/useT';
import { Answer } from '@/modules/demo/Answer';
import { useDemoStore } from '@/modules/demo/demo.store';
import { Transcript } from '@/modules/demo/Transcript';
import { useAnswerStore } from '@/stores/answer.store';
import { useAudioStore } from '@/stores/audio.store';
import { useTranscriptStore } from '@/stores/transcript.store';

/**
 * Tras "Simular respuesta" muestra la pregunta y la respuesta de ejemplo en streaming. Si la IA está
 * contestando una pregunta de lo que se dijo, muestra esa respuesta. Mientras se escucha (o queda
 * texto de la última escucha) muestra la transcripción en vivo.
 */
export function Expanded() {
  const t = useT();
  const answer = useDemoStore((s) => s.answer);
  const streaming = useDemoStore((s) => s.streaming);
  const asked = useAnswerStore((s) => s.question !== null);
  const listening = useAudioStore((s) => s.listening);
  const hasTranscript = useTranscriptStore((s) => s.lines.length > 0 || s.partial !== '');

  if (answer === null && asked) return <Answer />;
  if (answer === null && (listening || hasTranscript)) return <Transcript />;

  return (
    <div>
      <p className="mb-1 pr-16 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
        {t('demo.detected')}
      </p>
      <p className="mb-3 text-[12px] leading-snug text-ink-dim">{t('demo.question')}</p>
      <p className="text-[19px] leading-snug font-semibold text-ink">
        {answer ?? t('demo.answerShort')}
        {streaming && (
          <span className="orbit-pulse ml-0.5 inline-block h-[1em] w-[2px] translate-y-[3px] bg-accent" />
        )}
      </p>
    </div>
  );
}
