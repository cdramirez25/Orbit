import '@/styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { demoModule } from '@/modules/demo';
import { bindListeningToIsland } from '@/modules/demo/demo.store';
import { bindRegistryToIsland, useRegistryStore } from '@/modules/registry';
import { useAudioStore } from '@/stores/audio.store';
import { useIslandStore } from '@/stores/island.store';
import { useSettingsStore } from '@/stores/settings.store';
import { App } from '@/windows/island/App';

// Composition root del frontend: registrar módulos y enlazar registro ↔ isla.
useRegistryStore.getState().register(demoModule);
bindRegistryToIsland();

// Escucha del audio del sistema: volumen y estado desde Rust → las ondas de la isla.
void useAudioStore.getState().bind();
bindListeningToIsland();

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
