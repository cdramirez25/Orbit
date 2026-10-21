import { Markdown } from '@/components/Markdown';
import { useT } from '@/i18n/useT';
import { aiErrorKey } from '@/lib/ai/ai-error';
import { useAnswerStore } from '@/stores/answer.store';

/** La pregunta detectada (texto pequeño) y la respuesta de la IA (texto grande) en streaming. */
export function Answer() {
  const t = useT();
  const question = useAnswerStore((s) => s.question);
  const answer = useAnswerStore((s) => s.answer);
  const streaming = useAnswerStore((s) => s.streaming);
  const errorCode = useAnswerStore((s) => s.errorCode);

  return (
    <div>
      <p className="mb-1 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
        {t('answer.question')}
      </p>
      <p className="mb-3 text-[12px] leading-snug text-ink-dim">{question}</p>
      {(answer !== '' || streaming) && (
        <Markdown
          text={answer}
          className="text-[16px] leading-snug text-ink"
          trailing={
            streaming ? (
              <span className="orbit-pulse ml-0.5 inline-block h-[1em] w-[2px] translate-y-[3px] bg-accent" />
            ) : undefined
          }
        />
      )}
      {errorCode && (
        <p role="alert" className="text-[13px] leading-snug text-danger">
          {t(aiErrorKey(errorCode))}
        </p>
      )}
    </div>
  );
}
