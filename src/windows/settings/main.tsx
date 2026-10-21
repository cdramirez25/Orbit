import '@/styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SettingsPlaceholder } from '@/features/settings/SettingsPlaceholder';

// Ventana de ajustes: se implementa en la Fase 5.
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <SettingsPlaceholder />
    </StrictMode>,
  );
}
