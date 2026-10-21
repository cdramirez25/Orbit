import { Lock } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, Card, Input, Tab } from '@/components/ui';
import {
  AI_PROVIDERS,
  isProviderConfigured,
  type AiProvider,
} from '@/features/settings/ai/providers';
import { PageHeader } from '@/features/settings/layout';
import { useT } from '@/i18n/useT';
import { aiErrorKey } from '@/lib/ai/ai-error';
import { cn } from '@/lib/utils/cn';
import { useAiStore } from '@/stores/ai.store';
import type { AiProviderId } from '@/types';

function Chip({ children, tone }: { children: ReactNode; tone?: 'accent' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-medium text-ink-dim',
        tone === 'accent' && 'text-accent',
      )}
    >
      {children}
    </span>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-dim">{label}</span>
      {children}
    </label>
  );
}

/** Lo que el usuario está escribiendo en un proveedor y todavía no ha guardado. */
interface Draft {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const EMPTY_DRAFT: Draft = { apiKey: '', baseUrl: '', model: '' };

/**
 * Formulario de un proveedor: la nube pide clave de API y modelo; lo local, la dirección del
 * servidor y modelo. La clave solo viaja hacia Rust, que la guarda en este equipo: aquí no se vuelve a mostrar.
 */
function ProviderCard({ provider }: { provider: AiProvider }) {
  const t = useT();
  const status = useAiStore((s) => s.status?.providers.find((p) => p.id === provider.id));
  const active = useAiStore((s) => s.status?.active === provider.id);
  const models = useAiStore((s) => s.models[provider.id]);
  const busy = useAiStore((s) => s.busy);
  const testResult = useAiStore((s) => s.testResult);
  const saveError = useAiStore((s) => (s.saveError?.id === provider.id ? s.saveError.code : null));
  const save = useAiStore((s) => s.save);
  const test = useAiStore((s) => s.test);
  const setActive = useAiStore((s) => s.setActive);
  const loadModels = useAiStore((s) => s.loadModels);
  const [draft, setDraft] = useState<Draft | null>(null);

  const configured = isProviderConfigured(provider, status);
  const canListModels = provider.kind === 'local' || Boolean(status?.hasKey);

  // Con la clave (o la dirección) ya guardada se piden los modelos que ofrece, como sugerencias.
  useEffect(() => {
    if (canListModels && models === undefined) void loadModels(provider.id);
  }, [canListModels, models, loadModels, provider.id]);

  const value: Draft = {
    apiKey: draft?.apiKey ?? '',
    baseUrl: draft?.baseUrl ?? status?.baseUrl ?? '',
    model: draft?.model ?? status?.model ?? '',
  };
  const change = (patch: Partial<Draft>) =>
    setDraft({ ...(draft ?? EMPTY_DRAFT), ...value, ...patch });
  const dirty = draft !== null;
  const mine = busy?.id === provider.id;
  const result = testResult?.id === provider.id ? testResult : null;

  const onSave = async () => {
    const ok = await save(provider.id, {
      // La clave solo se manda si se escribió una; vacía no borra la guardada.
      ...(value.apiKey.trim() !== '' && { apiKey: value.apiKey }),
      ...(provider.kind === 'local' && { baseUrl: value.baseUrl }),
      model: value.model,
    });
    if (ok) setDraft(null); // la clave escrita se descarta en cuanto sale hacia Rust
  };

  const stateLabel = active
    ? 'ai.status.active'
    : configured
      ? 'ai.status.ready'
      : 'ai.status.unset';
  const Icon = provider.icon;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon aria-hidden className="size-4 text-ink" />
          <h3 className="text-[13px] font-semibold text-ink">{provider.name}</h3>
          <Chip>{t(provider.kind === 'cloud' ? 'ai.kind.cloud' : 'ai.kind.local')}</Chip>
        </div>
        <Chip tone={active ? 'accent' : undefined}>{t(stateLabel)}</Chip>
      </div>

      <p className="text-[11px] leading-snug text-ink-dim">{t(provider.description)}</p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {provider.kind === 'cloud' && (
          <FormField label={t('ai.field.apiKey')}>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value.apiKey}
              placeholder={status?.hasKey ? t('ai.field.apiKeySaved') : provider.apiKeyPlaceholder}
              onChange={(event) => change({ apiKey: event.target.value })}
            />
          </FormField>
        )}
        {provider.kind === 'local' && (
          <FormField label={t('ai.field.baseUrl')}>
            <Input
              autoComplete="off"
              spellCheck={false}
              value={value.baseUrl}
              placeholder={provider.baseUrlPlaceholder}
              onChange={(event) => change({ baseUrl: event.target.value })}
            />
          </FormField>
        )}
        <FormField label={t('ai.field.model')}>
          <Input
            autoComplete="off"
            spellCheck={false}
            list={`ai-models-${provider.id}`}
            value={value.model}
            placeholder={status?.defaultModel ?? t('ai.field.modelPlaceholder')}
            onChange={(event) => change({ model: event.target.value })}
          />
          <datalist id={`ai-models-${provider.id}`}>
            {(models ?? []).map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </FormField>
      </div>

      {saveError || result ? (
        <p
          role="status"
          className={cn('text-[11px] leading-snug', result?.ok ? 'text-accent' : 'text-danger')}
        >
          {result?.ok
            ? `${t('ai.result.ok')}: ${result.reply}`
            : t(aiErrorKey(result && !result.ok ? result.code : (saveError ?? '')))}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {provider.kind === 'cloud' && status?.hasKey && (
          <Button
            size="sm"
            variant="ghost"
            className="mr-auto"
            disabled={busy !== null}
            onClick={() => void save(provider.id, { apiKey: '' })}
          >
            {t('ai.action.removeKey')}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || dirty || !configured}
          onClick={() => void test(provider.id)}
        >
          {t(mine && busy?.action === 'test' ? 'ai.action.testing' : 'ai.action.test')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy !== null || !dirty}
          onClick={() => void onSave()}
        >
          {t('ai.action.save')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={active || dirty || !configured}
          onClick={() => void setActive(provider.id)}
        >
          {t(active ? 'ai.action.inUse' : 'ai.action.use')}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Para ver de inmediato cómo responde Orbit sin esperar a que suene una pregunta: se escribe una y
 * la respuesta sale en la isla, igual que la de una pregunta que se oiga en el audio.
 */
function AskBox() {
  const t = useT();
  const hasActive = useAiStore((s) => s.status?.active != null);
  const ask = useAiStore((s) => s.ask);
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState(false);
  const ready = hasActive && question.trim() !== '';

  const submit = () => {
    if (!ready) return;
    void ask(question.trim());
    setAsked(true);
  };

  return (
    <section className="flex flex-col gap-1.5 border-t border-white/8 pt-3">
      <h3 className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
        {t('ai.ask.title')}
      </h3>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          aria-label={t('ai.ask.title')}
          autoComplete="off"
          value={question}
          placeholder={t('ai.ask.placeholder')}
          onChange={(event) => {
            setQuestion(event.target.value);
            setAsked(false);
          }}
        />
        <Button type="submit" size="sm" variant="primary" disabled={!ready}>
          {t('ai.ask.action')}
        </Button>
      </form>
      <p className="text-[11px] leading-snug text-ink-faint">
        {t(hasActive ? 'ai.ask.hint' : 'ai.ask.needActive')}
        {asked && hasActive ? ' …' : ''}
      </p>
    </section>
  );
}

/** IA: con qué modelo responde Orbit. El usuario trae su propia clave o su propio servidor local. */
export function AiPage() {
  const t = useT();
  const [selected, setSelected] = useState<AiProviderId>('claude');
  const picked = useRef(false);
  const load = useAiStore((s) => s.load);
  const activeId = useAiStore((s) => s.status?.active);
  const provider = AI_PROVIDERS.find((p) => p.id === selected);

  useEffect(() => {
    void load();
  }, [load]);

  // Al abrir, se muestra el proveedor que está en uso (salvo que el usuario ya haya elegido otro).
  useEffect(() => {
    if (activeId && !picked.current) setSelected(activeId);
  }, [activeId]);

  return (
    <>
      <PageHeader title={t('settings.nav.ai')}>
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-ink-dim">
          <Lock aria-hidden className="mt-px size-3 shrink-0" />
          {t('ai.privacy')}
        </p>
      </PageHeader>

      <div className="flex flex-col gap-3">
        <div
          className="flex flex-wrap items-center gap-1"
          role="tablist"
          aria-label={t('ai.providersAria')}
        >
          {AI_PROVIDERS.map(({ id, name, icon: Icon }) => (
            <Tab
              key={id}
              selected={selected === id}
              className="inline-flex items-center gap-1.5"
              onClick={() => {
                picked.current = true;
                setSelected(id);
              }}
            >
              <Icon aria-hidden className="size-3" />
              {name}
              {activeId === id && <span aria-hidden className="size-1.5 rounded-full bg-accent" />}
            </Tab>
          ))}
        </div>

        {provider && <ProviderCard key={provider.id} provider={provider} />}
        <AskBox />
      </div>
    </>
  );
}
