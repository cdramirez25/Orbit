import { Button, Tab } from '@/components/ui';
import { Field, PageHeader, Section } from '@/features/settings/layout';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { useControlStore } from '@/stores/control.store';
import type { IslandAnchor, IslandState } from '@/types';

const STATES: ReadonlyArray<{ id: IslandState; label: MessageKey }> = [
  { id: 'hidden', label: 'settings.panel.hidden' },
  { id: 'idle', label: 'settings.panel.idle' },
  { id: 'compact', label: 'settings.panel.compact' },
  { id: 'expanded', label: 'settings.panel.expanded' },
];

const POSITIONS: ReadonlyArray<{ id: IslandAnchor; label: MessageKey }> = [
  { id: 'left', label: 'settings.panel.left' },
  { id: 'center', label: 'settings.panel.center' },
  { id: 'right', label: 'settings.panel.right' },
  { id: 'free', label: 'settings.panel.free' },
];

/** Cómo se comporta la isla y cómo se ve: estado, posición y estilo. */
export function IslandPage() {
  const t = useT();
  const current = useControlStore((s) => s.islandState);
  const style = useControlStore((s) => s.style);
  const anchor = useControlStore((s) => s.anchor);
  const goTo = useControlStore((s) => s.goTo);
  const simulate = useControlStore((s) => s.simulate);
  const showAlert = useControlStore((s) => s.alert);
  const setStyle = useControlStore((s) => s.setStyle);
  const setAnchor = useControlStore((s) => s.setAnchor);

  return (
    <>
      <PageHeader title={t('settings.nav.island')} />
      <div className="flex flex-col gap-3">
        <Section
          title={t('settings.section.behavior')}
          action={
            <Button size="sm" variant="primary" onClick={simulate}>
              {t('settings.panel.simulate')}
            </Button>
          }
        >
          <Field label={t('settings.panel.state')}>
            <div
              className="flex flex-wrap items-center gap-1"
              role="tablist"
              aria-label={t('settings.panel.stateAria')}
            >
              {STATES.map(({ id, label }) => (
                <Tab key={id} selected={current === id} className="px-2" onClick={() => goTo(id)}>
                  {t(label)}
                </Tab>
              ))}
              <Tab selected={current === 'alert'} className="px-2" onClick={showAlert}>
                {t('settings.panel.alert')}
              </Tab>
            </div>
          </Field>
        </Section>

        <Section title={t('settings.section.appearance')}>
          <Field label={t('settings.panel.position')}>
            <div
              className="flex flex-wrap items-center gap-1"
              role="tablist"
              aria-label={t('settings.panel.positionAria')}
            >
              {POSITIONS.map(({ id, label }) => (
                <Tab key={id} selected={anchor === id} onClick={() => setAnchor(id)}>
                  {t(label)}
                </Tab>
              ))}
            </div>
            {anchor === 'free' && (
              <span className="text-[11px] text-ink-faint">{t('settings.panel.freeHint')}</span>
            )}
          </Field>
          <Field label={t('settings.panel.style')}>
            <div
              className="flex items-center gap-1"
              role="tablist"
              aria-label={t('settings.panel.styleAria')}
            >
              <Tab selected={style === 'attached'} onClick={() => setStyle('attached')}>
                {t('settings.panel.attached')}
              </Tab>
              <Tab selected={style === 'floating'} onClick={() => setStyle('floating')}>
                {t('settings.panel.floating')}
              </Tab>
            </div>
          </Field>
        </Section>
      </div>
    </>
  );
}
