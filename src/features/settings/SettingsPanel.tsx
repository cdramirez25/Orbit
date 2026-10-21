import { useState } from 'react';

import { SettingsNav } from '@/features/settings/SettingsNav';
import type { SettingsPage } from '@/features/settings/settingsPages';
import { AiPage } from '@/features/settings/pages/AiPage';
import { AudioPage } from '@/features/settings/pages/AudioPage';
import { GeneralPage } from '@/features/settings/pages/GeneralPage';
import { IslandPage } from '@/features/settings/pages/IslandPage';
import { SessionsPage } from '@/features/settings/pages/SessionsPage';
import { useT } from '@/i18n/useT';

const PAGES: Record<SettingsPage, () => React.JSX.Element> = {
  island: IslandPage,
  sessions: SessionsPage,
  audio: AudioPage,
  ai: AiPage,
  general: GeneralPage,
};

/**
 * Contenido de la ventana de ajustes (solo en desarrollo): una barra lateral con las secciones
 * (Isla, Audio, IA, General) y, a la derecha, la página elegida. La isla vive en otra ventana, así
 * que sus controles hablan con ella a través de `useControlStore`.
 */
export function SettingsPanel() {
  const t = useT();
  const [page, setPage] = useState<SettingsPage>('island');
  const Page = PAGES[page];

  return (
    <div className="flex h-screen bg-neutral-900 text-ink">
      <SettingsNav page={page} onSelect={setPage} />
      <main
        aria-label={t('settings.panel.title')}
        className="min-w-0 flex-1 overflow-y-auto px-6 py-4"
      >
        <Page />
      </main>
    </div>
  );
}
