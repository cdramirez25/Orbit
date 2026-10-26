import { Section } from '@/features/settings/layout';
import { SoundOutputSelect } from '@/features/settings/pages/SoundOutputSelect';
import { useT } from '@/i18n/useT';

/** La salida de sonido del equipo, para la página de Audio. */
export function SoundOutputSection() {
  const t = useT();
  return (
    <Section title={t('soundOutput.section')}>
      <SoundOutputSelect />
      <p className="text-[11px] leading-snug text-ink-faint">{t('soundOutput.hint')}</p>
    </Section>
  );
}
