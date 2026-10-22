import { Check } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button, Card } from '@/components/ui';
import { AiProviderPicker } from '@/features/settings/pages/AiPage';
import { ModelControls } from '@/features/settings/pages/TranscriptionSection';
import { guideSteps, type StepId } from '@/features/onboarding/steps';
import { PermissionActions, PermissionChip } from '@/features/settings/pages/PermissionControls';
import { Keys } from '@/features/settings/pages/ShortcutsSection';
import { usePermissionPolling } from '@/hooks/usePermissionPolling';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils/cn';
import { useAiStore } from '@/stores/ai.store';
import { useAudioStore } from '@/stores/audio.store';
import { useGuideStore } from '@/stores/guide.store';
import { useModelStore } from '@/stores/model.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useShortcutStore } from '@/stores/shortcuts.store';
import type { UiAction } from '@/types';

const TITLE: Record<StepId, MessageKey> = {
  welcome: 'guide.welcome.title',
  audio: 'guide.audio.title',
  model: 'guide.model.title',
  ai: 'guide.ai.title',
  done: 'guide.done.title',
};

const ACTION_TEXT: Record<UiAction, MessageKey> = {
  toggleQuestion: 'guide.done.record',
  toggleIsland: 'guide.done.island',
};

function StepBody({ step }: { step: StepId }): ReactNode {
  const t = useT();
  const shortcuts = useShortcutStore((s) => s.shortcuts);

  switch (step) {
    case 'welcome':
      return (
        <>
          <p className="text-[13px] leading-relaxed text-ink-dim">{t('guide.welcome.body')}</p>
          <ul className="flex flex-col gap-1.5 text-[12px] text-ink">
            {(
              ['guide.welcome.point1', 'guide.welcome.point2', 'guide.welcome.point3'] as const
            ).map((key) => (
              <li key={key} className="flex items-start gap-2">
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent" />
                {t(key)}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-faint">{t('guide.welcome.setup')}</p>
        </>
      );
    case 'audio':
      return (
        <>
          <p className="text-[13px] leading-relaxed text-ink-dim">{t('guide.audio.body')}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <PermissionChip />
            <PermissionActions />
          </div>
          <span className="text-[11px] text-ink-faint">{t('audio.permission.restartHint')}</span>
        </>
      );
    case 'model':
      return (
        <>
          <p className="text-[13px] leading-relaxed text-ink-dim">{t('guide.model.body')}</p>
          <Card className="flex flex-col gap-2">
            <ModelControls />
          </Card>
        </>
      );
    case 'ai':
      return (
        <>
          <p className="text-[13px] leading-relaxed text-ink-dim">{t('guide.ai.body')}</p>
          <AiProviderPicker />
        </>
      );
    case 'done':
      return (
        <>
          <p className="text-[13px] leading-relaxed text-ink-dim">{t('guide.done.body')}</p>
          <ul className="flex flex-col gap-2">
            {shortcuts.map(({ action, keys }) => (
              <li key={action} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="text-ink">{t(ACTION_TEXT[action])}</span>
                <Keys keys={keys} />
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-faint">{t('guide.done.more')}</p>
        </>
      );
  }
}

/**
 * La guía de primer arranque: una ventana por pasos (permiso de audio, modelo de voz, IA) que
 * sale sola la primera vez. Cada paso se marca como hecho al cumplirse y se puede saltar.
 */
export function Onboarding() {
  const t = useT();
  const permission = useAudioStore((s) => s.permission);
  const modelReady = useModelStore((s) => s.status?.state === 'ready');
  const aiActive = useAiStore((s) => s.status?.active != null);
  const loadAi = useAiStore((s) => s.load);
  const setOnboardingDone = useSettingsStore((s) => s.setOnboardingDone);
  const hide = useGuideStore((s) => s.hide);
  const [index, setIndex] = useState(0);

  usePermissionPolling();
  useEffect(() => {
    void loadAi();
  }, [loadAi]);

  const steps = guideSteps(permission !== 'notRequired');
  const current = Math.min(index, steps.length - 1);
  const step = steps[current] ?? 'welcome';
  const doneStates: Record<StepId, boolean> = {
    welcome: true,
    audio: permission === 'granted' || permission === 'notRequired',
    model: modelReady,
    ai: aiActive,
    done: true,
  };
  const stepDone = doneStates[step];
  const last = current === steps.length - 1;

  const finish = () => {
    void setOnboardingDone(true);
    hide();
  };

  return (
    <div className="flex h-screen flex-col bg-neutral-900 text-ink">
      <header className="flex items-center justify-between gap-3 border-b border-white/8 px-6 py-3">
        <h1 className="text-[13px] font-semibold text-ink">{t('guide.title')}</h1>
        {!last && (
          <Button size="sm" variant="ghost" onClick={finish}>
            {t('guide.action.skipAll')}
          </Button>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-[560px] flex-col gap-4">
          <ol aria-label={t('guide.stepsAria')} className="flex items-center justify-center gap-2">
            {steps.map((id, position) => {
              // Un paso con algo que cumplir (permiso, modelo, IA) se ve hecho solo si de verdad se
              // cumplió, aunque se haya saltado. La bienvenida se da por hecha al pasar de ella.
              const measurable = id === 'audio' || id === 'model' || id === 'ai';
              const complete =
                position !== current && (measurable ? doneStates[id] : position < current);
              return (
                <li
                  key={id}
                  aria-current={position === current ? 'step' : undefined}
                  className="flex items-center gap-2"
                >
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full text-[11px] font-medium',
                      position === current
                        ? 'bg-white text-black'
                        : complete
                          ? 'bg-accent text-black'
                          : 'bg-white/10 text-ink-dim',
                    )}
                  >
                    {complete && position !== current ? (
                      <Check aria-hidden className="size-3.5" />
                    ) : (
                      position + 1
                    )}
                    <span className="sr-only">{t(TITLE[id])}</span>
                  </span>
                  {position < steps.length - 1 && (
                    <span aria-hidden className="h-px w-6 bg-white/15" />
                  )}
                </li>
              );
            })}
          </ol>

          <div className="flex flex-col gap-1 text-center">
            <p className="text-[11px] tracking-wider text-ink-faint uppercase">
              {t('guide.step')} {current + 1} {t('guide.of')} {steps.length}
            </p>
            <h2 className="text-[18px] font-semibold text-ink">{t(TITLE[step])}</h2>
          </div>

          <section className="flex flex-col gap-3">
            <StepBody step={step} />
          </section>
        </div>
      </main>

      <footer className="flex items-center justify-between gap-3 border-t border-white/8 px-6 py-3">
        <div>
          {current > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setIndex(current - 1)}>
              {t('guide.action.back')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!last && step !== 'welcome' && !stepDone && (
            <Button size="sm" variant="ghost" onClick={() => setIndex(current + 1)}>
              {t('guide.action.skipStep')}
            </Button>
          )}
          {last ? (
            <Button size="sm" variant="primary" onClick={finish}>
              {t('guide.action.finish')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={!stepDone}
              onClick={() => setIndex(current + 1)}
            >
              {t(step === 'welcome' ? 'guide.action.start' : 'guide.action.next')}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
