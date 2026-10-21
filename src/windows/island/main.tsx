import '@/styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { clipboardModule } from '@/modules/clipboard';
import { demoModule } from '@/modules/demo';
import { bindListeningToIsland } from '@/modules/demo/demo.store';
import { bindRegistryToIsland, useRegistryStore } from '@/modules/registry';
import { weatherModule } from '@/modules/weather';
import { useAudioStore } from '@/stores/audio.store';
import { useClipboardStore } from '@/stores/clipboard.store';
import { useIslandStore } from '@/stores/island.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useWeatherStore } from '@/stores/weather.store';
import { App } from '@/windows/island/App';
import { bindRemoteControl } from '@/windows/island/remote';

// Composition root del frontend: registrar módulos y enlazar el registro con la isla.
const registry = useRegistryStore.getState();
registry.register(demoModule);
registry.register(weatherModule);
registry.register(clipboardModule);
bindRegistryToIsland();

// Módulos residentes: el clima (se actualiza solo) y el historial del portapapeles (Rust avisa de
// cada cambio). Al tener actividad, la isla muestra su pastilla en vez de quedarse en reposo.
useWeatherStore.getState().startPolling();
void useClipboardStore.getState().bind();
registry.startActivity(weatherModule.id);
registry.startActivity(clipboardModule.id);

// Escucha del audio del sistema: volumen y estado desde Rust → las ondas de la isla.
void useAudioStore.getState().bind();
bindListeningToIsland();

// La ventana de ajustes (otra ventana) controla la isla con mensajes.
bindRemoteControl();

// Lo guardado por Rust: dónde está la isla (izquierda / centro / derecha / libre).
void useSettingsStore.getState().load();

// En un Mac con notch la isla nace pegada al borde; sin notch (o en Windows), flotante.
void useIslandStore
  .getState()
  .loadNotch()
  .then(() => {
    const notch = useIslandStore.getState().notch;
    useSettingsStore.getState().setIslandStyle(notch?.hasNotch ? 'attached' : 'floating');
  });

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
