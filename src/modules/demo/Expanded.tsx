import { useDemoStore } from '@/modules/demo/demo.store';

/** Pregunta detectada (texto pequeño) y respuesta (texto grande) en streaming. */
export function Expanded() {
  const question = useDemoStore((s) => s.question);
  const answer = useDemoStore((s) => s.answer);
  const streaming = useDemoStore((s) => s.streaming);

  return (
    <div>
      <p className="mb-1 pr-8 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
        Pregunta detectada
      </p>
      <p className="mb-3 text-[12px] leading-snug text-ink-dim">{question}</p>
      <p className="text-[19px] leading-snug font-semibold text-ink">
        {answer}
        {streaming && (
          <span className="orbit-pulse ml-0.5 inline-block h-[1em] w-[2px] translate-y-[3px] bg-accent" />
        )}
      </p>
    </div>
  );
}
