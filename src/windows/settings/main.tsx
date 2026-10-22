import '@/styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { useAudioStore } from '@/stores/audio.store';
import { useControlStore } from '@/stores/control.store';
import { useModelStore } from '@/stores/model.store';
import { useSessionStore } from '@/stores/session.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useShortcutStore } from '@/stores/shortcuts.store';

// Ventana de ajustes (por ahora, el panel de desarrollo). La isla vive en otra ventana: aquí solo
// se escucha su estado y se le mandan órdenes.
void useControlStore.getState().bind();
// Volumen y estado de la escucha llegan de Rust a todas las ventanas.
void useAudioStore.getState().bind();
// Lo guardado por Rust (ocultar de screen share).
void useSettingsStore.getState().load();
// Las sesiones (prompt e historial) se editan aquí y se usan desde la isla: se avisan por eventos.
void useSessionStore.getState().bind();
// El modelo de transcripción (descargado o no, y el progreso de su descarga) y los atajos globales.
void useModelStore.getState().bind();
void useShortcutStore.getState().load();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <SettingsPanel />
    </StrictMode>,
  );
}
