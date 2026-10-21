import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Markdown } from '@/components/Markdown';
import { Button, Input, NavItem, Tab, Textarea, Toggle } from '@/components/ui';
import { AI_PROVIDERS, isProviderConfigured } from '@/features/settings/ai/providers';
import { PageHeader } from '@/features/settings/layout';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils/cn';
import { useAiStore } from '@/stores/ai.store';
import { selectActiveSession, useSessionStore } from '@/stores/session.store';
import type { Session, SessionMessage } from '@/types';

/** Qué se dijo y qué contestó la IA en la sesión: es el contexto que la IA tiene. */
function History({ messages }: { messages: SessionMessage[] }) {
  const t = useT();

  return (
    <section className="flex flex-col gap-1.5 border-t border-white/8 pt-3">
      <h3 className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
        {t('sessions.history.title')}
      </h3>
      {messages.length === 0 ? (
        <p className="text-[11px] text-ink-faint">{t('sessions.history.empty')}</p>
      ) : (
        <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1">
          {messages.map((message) => (
            <li key={message.id} className="text-[11px] leading-snug">
              <span
                className={cn(
                  'mr-1.5 font-semibold',
                  message.role === 'user' ? 'text-ink-dim' : 'text-accent',
                )}
              >
                {t(
                  message.role === 'user' ? 'sessions.history.question' : 'sessions.history.answer',
                )}
              </span>
              {message.role === 'assistant' ? (
                <Markdown text={message.content} className="mt-0.5 text-ink" />
              ) : (
                <span className="text-ink">{message.content}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * La IA de la sesión: "Predeterminada" (la que esté en uso en Ajustes) o una de las que el usuario
 * tiene registradas. Se guarda al elegir.
 */
function ProviderPicker({ session }: { session: Session }) {
  const t = useT();
  const aiStatus = useAiStore((s) => s.status);
  const loadAi = useAiStore((s) => s.load);
  const update = useSessionStore((s) => s.update);

  useEffect(() => {
    void loadAi();
  }, [loadAi]);

  // Las registradas, y la de la sesión aunque ya no lo esté (para que se vea y se pueda cambiar).
  const options = AI_PROVIDERS.filter(
    (provider) =>
      provider.id === session.provider ||
      isProviderConfigured(
        provider,
        aiStatus?.providers.find((p) => p.id === provider.id),
      ),
  );
  const activeName = AI_PROVIDERS.find((provider) => provider.id === aiStatus?.active)?.name;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-ink-dim">{t('sessions.field.ai')}</span>
      <div
        role="tablist"
        aria-label={t('sessions.field.ai')}
        className="flex flex-wrap items-center gap-1"
      >
        <Tab
          selected={session.provider === null}
          onClick={() => void update(session.id, { provider: '' })}
        >
          {t('sessions.ai.default')}
        </Tab>
        {options.map(({ id, name, icon: Icon }) => (
          <Tab
            key={id}
            selected={session.provider === id}
            className="inline-flex items-center gap-1.5"
            onClick={() => void update(session.id, { provider: id })}
          >
            <Icon aria-hidden className="size-3" />
            {name}
          </Tab>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-ink-faint">
        {options.length === 0
          ? t('sessions.ai.none')
          : session.provider === null
            ? `${t('sessions.ai.defaultHint')}${activeName ? ` (${activeName})` : ''}`
            : t('sessions.ai.hint')}
      </p>
    </div>
  );
}

/** Nombre, prompt y opciones de una sesión. Lo escrito se guarda con "Guardar". */
function SessionEditor({ session, messages }: { session: Session; messages: SessionMessage[] }) {
  const t = useT();
  const update = useSessionStore((s) => s.update);
  const remove = useSessionStore((s) => s.remove);
  const clearHistory = useSessionStore((s) => s.clearHistory);
  const errorCode = useSessionStore((s) => s.errorCode);
  const [name, setName] = useState(session.name);
  const [prompt, setPrompt] = useState(session.prompt);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dirty = name !== session.name || prompt !== session.prompt;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-dim">{t('sessions.field.name')}</span>
        <Input
          value={name}
          maxLength={80}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-dim">{t('sessions.field.prompt')}</span>
          <Textarea
            rows={5}
            value={prompt}
            maxLength={4000}
            placeholder={t('sessions.field.promptPlaceholder')}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <p className="text-[11px] leading-snug text-ink-faint">{t('sessions.field.promptHint')}</p>
      </div>

      <ProviderPicker session={session} />

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-[12px] text-ink">
          <Toggle
            label={t('sessions.field.autoAnswer')}
            checked={session.autoAnswer}
            onCheckedChange={(checked) => void update(session.id, { autoAnswer: checked })}
          />
          {t('sessions.field.autoAnswer')}
        </label>
        <p className="text-[11px] leading-snug text-ink-faint">
          {t('sessions.field.autoAnswerHint')}
        </p>
      </div>

      {errorCode && (
        <p role="alert" className="text-[11px] text-danger">
          {t(
            errorCode === 'session.emptyName'
              ? 'sessions.error.emptyName'
              : 'sessions.error.generic',
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty}
          onClick={() => void update(session.id, { name, prompt })}
        >
          {t('sessions.action.save')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={messages.length === 0}
          onClick={() => void clearHistory(session.id)}
        >
          {t('sessions.action.clear')}
        </Button>
        {confirmingDelete ? (
          <>
            <Button size="sm" variant="danger" onClick={() => void remove(session.id)}>
              {t('sessions.action.delete')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              {t('prompter.cancel')}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
            {t('sessions.action.delete')}
          </Button>
        )}
      </div>

      <History messages={messages} />
    </div>
  );
}

/**
 * Sesiones: cada una tiene su prompt (cómo debe actuar la IA) y su historial de preguntas y
 * respuestas, que es el contexto de la IA. Elegir una en la lista la deja como la sesión activa.
 */
export function SessionsPage() {
  const t = useT();
  const state = useSessionStore((s) => s.state);
  const active = useSessionStore(selectActiveSession);
  const messages = useSessionStore((s) => s.messages);
  const load = useSessionStore((s) => s.load);
  const create = useSessionStore((s) => s.create);
  const setActive = useSessionStore((s) => s.setActive);
  const sessions = state?.sessions ?? [];

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader title={t('settings.nav.sessions')} />
      <div className="flex gap-4">
        <div className="flex w-40 shrink-0 flex-col gap-1">
          <Button
            size="sm"
            variant="primary"
            onClick={() => void create(`${t('sessions.defaultName')} ${sessions.length + 1}`)}
          >
            <Plus aria-hidden className="size-3" />
            {t('sessions.new')}
          </Button>
          <nav aria-label={t('sessions.listAria')} className="mt-1 flex flex-col gap-0.5">
            {sessions.map((session) => (
              <NavItem
                key={session.id}
                current={session.id === state?.active}
                onClick={() => void setActive(session.id)}
              >
                <span className="truncate">{session.name}</span>
              </NavItem>
            ))}
          </nav>
        </div>

        {active ? (
          <SessionEditor key={active.id} session={active} messages={messages} />
        ) : (
          <p className="text-[12px] leading-snug text-ink-faint">{t('sessions.empty')}</p>
        )}
      </div>
    </>
  );
}
