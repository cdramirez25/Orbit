import type { ReactNode } from 'react';

/** Título de una página de ajustes. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-3 flex flex-col gap-1">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {children}
    </header>
  );
}

/** Bloque de una página: título pequeño y, debajo, sus controles. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  /** Botón a la derecha del título (una acción de la sección). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-white/8 pt-3 first:border-t-0 first:pt-0">
      <div className="flex min-h-6 items-center justify-between">
        <h3 className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Fila con rótulo (arriba) y controles (abajo). */
export function Field({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-[11px] text-ink-dim">{label}</span>}
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}
