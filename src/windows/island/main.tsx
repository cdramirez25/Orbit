import '@/styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { clipboardModule } from '@/modules/clipboard';
import { demoModule } from '@/modules/demo';
import {
  bindAnswerToIsland,
  bindDemoToIsland,
  bindListeningToIsland,
  bindTranscriptToIsland,
} from '@/modules/demo/demo.store';
import { musicModule } from '@/modules/music';
import { prompterModule } from '@/modules/prompter';
import { bindRegistryToIsland, useRegistryStore } from '@/modules/registry';
import { weatherModule } from '@/modules/weather';
import { useAnswerStore } from '@/stores/answer.store';
import { useAudioStore } from '@/stores/audio.store';
import { useClipboardStore } from '@/stores/clipboard.store';
import { useIslandStore } from '@/stores/island.store';
import { useMediaStore } from '@/stores/media.store';
import { useQuestionStore } from '@/stores/question.store';
import { useSessionStore } from '@/stores/session.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useTranscriptStore } from '@/stores/transcript.store';
import { useWeatherStore } from '@/stores/weather.store';
import { bindUiActions } from '@/windows/island/actions';
import { App } from '@/windows/island/App';
import { bindRemoteControl } from '@/windows/island/remote';
import { bindTrayLabels } from '@/windows/island/tray';

// Composition root del frontend: registrar módulos y enlazar el registro con la isla.
const registry = useRegistryStore.getState();
registry.register(demoModule);
registry.register(weatherModule);
registry.register(clipboardModule);
registry.register(musicModule);
registry.register(prompterModule);
bindRegistryToIsland();

// Módulos residentes: el clima (se actualiza solo), el historial del portapapeles y lo que suena
// (Rust avisa de cada cambio). Al tener actividad, la isla muestra su pastilla en vez de quedarse en reposo.
useWeatherStore.getState().startPolling();
void useClipboardStore.getState().bind();
void useMediaStore.getState().bind();
registry.startActivity(weatherModule.id);
registry.startActivity(clipboardModule.id);
registry.startActivity(musicModule.id);
registry.startActivity(prompterModule.id);

// Escucha del audio del sistema: volumen y estado desde Rust → las ondas de la isla.
void useAudioStore.getState().bind();
// Lo que se dice (Whisper, en Rust) llega como parciales y finales.
void useTranscriptStore.getState().bind();
// Si lo que se dijo es una pregunta, la IA la contesta y la respuesta llega por trozos.
void useAnswerStore.getState().bind();
// Sesiones (cada una con su prompt e historial) y si ya se estaba grabando una pregunta.
void useSessionStore.getState().bind();
void useQuestionStore.getState().sync();
bindListeningToIsland();
bindDemoToIsland();
bindTranscriptToIsland();
bindAnswerToIsland();

// La ventana de ajustes (otra ventana) controla la isla con mensajes.
bindRemoteControl();

// Los atajos globales y la bandeja del sistema (Rust) piden cosas a la isla; la bandeja se rotula
// con el idioma de la interfaz.
void bindUiActions();
bindTrayLabels();

// Lo guardado por Rust (ocultar de screen share…). La isla siempre arranca centrada: Rust ya
// ignora la posición guardada al abrir.
void useSettingsStore.getState().load();

// La isla siempre arranca compacta (por los módulos residentes) y pegada al borde de arriba: sobre
// el notch si lo hay y, si no, con un notch ficticio. El usuario puede cambiarla en los ajustes.
useSettingsStore.getState().setIslandStyle('attached');
void useIslandStore.getState().loadNotch();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
