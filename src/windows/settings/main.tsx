import '@/styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Ventana de ajustes: se implementa en la Fase 5.
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <p className="p-6 text-sm">Ajustes de Orbit — próximamente (Fase 5).</p>
    </StrictMode>,
  );
}
