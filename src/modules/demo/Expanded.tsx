import { useT } from '@/i18n/useT';
import { useDemoStore } from '@/modules/demo/demo.store';

/** Pregunta detectada (texto pequeño) y respuesta (texto grande) en streaming. */
export function Expanded() {
  const t = useT();
  const answer = useDemoStore((s) => s.answer) ?? t('demo.answerShort');
  const streaming = useDemoStore((s) => s.streaming);

  return (
    <div>
      <p className="mb-1 pr-16 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
        {t('demo.detected')}
      </p>
      <p className="mb-3 text-[12px] leading-snug text-ink-dim">{t('demo.question')}</p>
      <p className="text-[19px] leading-snug font-semibold text-ink">
        {answer}
        {streaming && (
          <span className="orbit-pulse ml-0.5 inline-block h-[1em] w-[2px] translate-y-[3px] bg-accent" />
        )}
      </p>
    </div>
  );
}
