import type { ReactNode } from 'react';

import { parseMarkdown, type Block, type Span } from '@/lib/markdown';
import { cn } from '@/lib/utils/cn';

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, index) => {
        let node: ReactNode = span.text;
        if (span.code) {
          node = (
            <code className="rounded bg-white/12 px-1 py-px font-mono text-[0.88em]">{node}</code>
          );
        }
        if (span.italic) node = <em>{node}</em>;
        if (span.bold) node = <strong className="font-semibold text-white">{node}</strong>;
        return <span key={index}>{node}</span>;
      })}
    </>
  );
}

/** Líneas de un párrafo separadas por saltos de línea. */
function Lines({ lines, trailing }: { lines: Span[][]; trailing?: ReactNode }) {
  return (
    <>
      {lines.map((spans, index) => (
        <span key={index}>
          {index > 0 && <br />}
          <Spans spans={spans} />
          {index === lines.length - 1 && trailing}
        </span>
      ))}
    </>
  );
}

function BlockView({ block, trailing }: { block: Block; trailing?: ReactNode }) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p>
          <Lines lines={block.lines} trailing={trailing} />
        </p>
      );
    case 'heading':
      return (
        <p className="font-semibold text-white">
          <Spans spans={block.spans} />
          {trailing}
        </p>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List
          className={cn('flex flex-col gap-0.5 pl-5', block.ordered ? 'list-decimal' : 'list-disc')}
        >
          {block.items.map((spans, index) => (
            <li key={index}>
              <Spans spans={spans} />
              {index === block.items.length - 1 && trailing}
            </li>
          ))}
        </List>
      );
    }
    case 'code':
      return (
        <>
          <pre className="overflow-x-auto rounded-lg bg-white/8 px-2.5 py-1.5 font-mono text-[0.85em] leading-snug whitespace-pre">
            {block.text}
          </pre>
          {trailing}
        </>
      );
  }
}

/**
 * Pinta el texto de la IA con su formato (negritas, cursivas, código, listas). `trailing` va pegado
 * al final del último bloque (por ejemplo, el cursor mientras la respuesta sigue llegando).
 */
export function Markdown({
  text,
  trailing,
  className,
}: {
  text: string;
  trailing?: ReactNode;
  className?: string;
}) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return trailing ? <p className={className}>{trailing}</p> : null;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          trailing={index === blocks.length - 1 ? trailing : undefined}
        />
      ))}
    </div>
  );
}
