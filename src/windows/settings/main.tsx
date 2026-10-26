import '@/styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/windows/settings/App';
import { useAudioStore } from '@/stores/audio.store';
import { useControlStore } from '@/stores/control.store';
import { useGuideStore } from '@/stores/guide.store';
import { useModelStore } from '@/stores/model.store';
import { useSessionStore } from '@/stores/session.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useShortcutStore } from '@/stores/shortcuts.store';
import { useWallpaperStore } from '@/stores/wallpaper.store';

// Ventana de ajustes (por ahora, el panel de desarrollo). La isla vive en otra ventana: aquí solo
// se escucha su estado y se le mandan órdenes.
void useControlStore.getState().bind();
// Volumen y estado de la escucha llegan de Rust a todas las ventanas.
void useAudioStore.getState().bind();
// Lo guardado por Rust (ocultar de screen share…). La primera vez, en lugar de los ajustes sale la
// guía de primer arranque.
void useSettingsStore
  .getState()
  .load()
  .then(() => {
    if (!useSettingsStore.getState().onboardingDone) useGuideStore.getState().show();
  });
// Las sesiones (prompt e historial) se editan aquí y se usan desde la isla: se avisan por eventos.
void useSessionStore.getState().bind();
// El modelo de transcripción (descargado o no, y el progreso de su descarga) y los atajos globales.
void useModelStore.getState().bind();
void useShortcutStore.getState().load();
// El fondo de pantalla (qué archivo, y si se pausó solo por rendimiento).
void useWallpaperStore.getState().bind();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
