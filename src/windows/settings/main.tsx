import '@/styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useAudioStore } from '@/stores/audio.store';
import { useControlStore } from '@/stores/control.store';
import { useSettingsStore } from '@/stores/settings.store';

// Ventana de ajustes (por ahora, el panel de desarrollo). La isla vive en otra ventana: aquí solo
// se escucha su estado y se le mandan órdenes.
void useControlStore.getState().bind();
// Volumen y estado de la escucha llegan de Rust a todas las ventanas.
void useAudioStore.getState().bind();
// Lo guardado por Rust (ocultar de screen share).
void useSettingsStore.getState().load();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <SettingsPanel />
    </StrictMode>,
  );
}
