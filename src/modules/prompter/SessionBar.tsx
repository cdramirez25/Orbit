import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import { IconButton } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { selectActiveSession, useSessionStore } from '@/stores/session.store';

/**
 * La sesión con la que se pregunta: su nombre, flechas para cambiar a otra y un botón para crear una
 * nueva. El prompt de cada sesión se escribe en Ajustes.
 */
export function SessionBar() {
  const t = useT();
  const state = useSessionStore((s) => s.state);
  const active = useSessionStore(selectActiveSession);
  const setActive = useSessionStore((s) => s.setActive);
  const create = useSessionStore((s) => s.create);
  const sessions = state?.sessions ?? [];
  const index = sessions.findIndex((session) => session.id === state?.active);

  const move = (step: number) => {
    if (sessions.length < 2) return;
    const next = sessions[(Math.max(index, 0) + step + sessions.length) % sessions.length];
    if (next) void setActive(next.id);
  };

  return (
    <div
      role="group"
      aria-label={t('prompter.session.aria')}
      className="flex min-w-0 items-center gap-0.5"
    >
      <IconButton
        label={t('prompter.session.previous')}
        className="size-6"
        disabled={sessions.length < 2}
        onClick={() => move(-1)}
      >
        <ChevronLeft aria-hidden className="size-3.5" />
      </IconButton>
      <span className="max-w-32 truncate px-1 text-[12px] font-medium text-ink">
        {active?.name ?? t('prompter.session.none')}
      </span>
      <IconButton
        label={t('prompter.session.next')}
        className="size-6"
        disabled={sessions.length < 2}
        onClick={() => move(1)}
      >
        <ChevronRight aria-hidden className="size-3.5" />
      </IconButton>
      <IconButton
        label={t('prompter.session.new')}
        className="size-6"
        onClick={() => void create(`${t('sessions.defaultName')} ${sessions.length + 1}`)}
      >
        <Plus aria-hidden className="size-3.5" />
      </IconButton>
    </div>
  );
}
