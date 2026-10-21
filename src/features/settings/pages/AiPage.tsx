import { Lock } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button, Card, Input, Tab } from '@/components/ui';
import { AI_PROVIDERS, type AiProvider, type AiProviderId } from '@/features/settings/ai/providers';
import { PageHeader } from '@/features/settings/layout';
import { useT } from '@/i18n/useT';

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-medium text-ink-dim">
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

/**
 * Formulario de un proveedor. Por ahora es solo el diseño: los campos están deshabilitados y no se
 * guarda nada. Cuando se conecte, la clave se guardará solo en el equipo del usuario.
 */
function ProviderCard({ provider }: { provider: AiProvider }) {
  const t = useT();
  const Icon = provider.icon;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon aria-hidden className="size-4 text-ink" />
          <h3 className="text-[13px] font-semibold text-ink">{provider.name}</h3>
          <Chip>{t(provider.kind === 'cloud' ? 'ai.kind.cloud' : 'ai.kind.local')}</Chip>
        </div>
        <Chip>{t('ai.status.unset')}</Chip>
      </div>

      <p className="text-[11px] leading-snug text-ink-dim">{t(provider.description)}</p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {provider.apiKeyPlaceholder && (
          <FormField label={t('ai.field.apiKey')}>
            <Input
              type="password"
              autoComplete="off"
              disabled
              placeholder={provider.apiKeyPlaceholder}
            />
          </FormField>
        )}
        {provider.baseUrlPlaceholder && (
          <FormField label={t('ai.field.baseUrl')}>
            <Input disabled placeholder={provider.baseUrlPlaceholder} />
          </FormField>
        )}
        <FormField label={t('ai.field.model')}>
          <Input disabled placeholder={t('ai.field.modelPlaceholder')} />
        </FormField>
      </div>

      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="secondary" disabled>
          {t('ai.action.test')}
        </Button>
        <Button size="sm" variant="primary" disabled>
          {t('ai.action.save')}
        </Button>
      </div>
    </Card>
  );
}

/** IA: con qué modelo responde Orbit. El usuario trae su propia clave o su propio servidor local. */
export function AiPage() {
  const t = useT();
  const [selected, setSelected] = useState<AiProviderId>('claude');
  const provider = AI_PROVIDERS.find((p) => p.id === selected);

  return (
    <>
      <PageHeader title={t('settings.nav.ai')}>
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-ink-dim">
          <Lock aria-hidden className="mt-px size-3 shrink-0" />
          {t('ai.privacy')}
        </p>
      </PageHeader>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-xl bg-white/6 px-3 py-2">
          <Chip>{t('ai.comingSoon')}</Chip>
          <p className="text-[11px] leading-snug text-ink-dim">{t('ai.comingSoonHint')}</p>
        </div>

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
              onClick={() => setSelected(id)}
            >
              <Icon aria-hidden className="size-3" />
              {name}
            </Tab>
          ))}
        </div>

        {provider && <ProviderCard provider={provider} />}
      </div>
    </>
  );
}
