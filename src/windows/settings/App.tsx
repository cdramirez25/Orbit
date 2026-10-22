import { Onboarding } from '@/features/onboarding/Onboarding';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useGuideStore } from '@/stores/guide.store';

/** La ventana de ajustes: la guía de primer arranque mientras toca verla y, si no, los ajustes. */
export function App() {
  const guideVisible = useGuideStore((s) => s.visible);
  return guideVisible ? <Onboarding /> : <SettingsPanel />;
}
