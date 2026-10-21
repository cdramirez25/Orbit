import { useLocaleStore } from '@/i18n/locale.store';
import { remote } from '@/ipc/remote';
import { useDemoStore } from '@/modules/demo/demo.store';
import { useIslandStore } from '@/stores/island.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { RemoteCommand, RemoteState } from '@/types';

/** Lo que la ventana de ajustes ve de la isla. */
export function currentRemoteState(): RemoteState {
  return {
    islandState: useIslandStore.getState().snapshot.state,
    style: useSettingsStore.getState().islandStyle,
    anchor: useSettingsStore.getState().anchor,
  };
}

/** Ejecuta una orden que llega de la ventana de ajustes. */
export function applyRemoteCommand(command: RemoteCommand): void {
  switch (command.type) {
    case 'goTo':
      // Solo mueve la isla entre sus estados: muestra los módulos de siempre. El módulo de
      // demostración solo entra con "Simular respuesta" o al escuchar.
      useIslandStore.getState().goTo(command.state);
      break;
    case 'alert':
      useDemoStore.getState().showDemoAlert();
      break;
    case 'simulate':
      useDemoStore.getState().streamAnswer();
      break;
    case 'setStyle':
      useSettingsStore.getState().setIslandStyle(command.style);
      break;
    case 'setAnchor':
      void useSettingsStore.getState().setAnchor(command.anchor);
      break;
    case 'setLocale':
      useLocaleStore.getState().setLocale(command.locale);
      break;
  }
}

/**
 * Deja que la ventana de ajustes controle la isla: atiende sus órdenes, responde cuando pide el
 * estado y lo vuelve a publicar cada vez que cambia.
 */
export function bindRemoteControl(): void {
  const publish = () => void remote.publishState(currentRemoteState());

  void remote.onCommand(applyRemoteCommand);
  void remote.onStateRequest(publish);

  useIslandStore.subscribe((state, previous) => {
    if (state.snapshot.state !== previous.snapshot.state) publish();
  });
  useSettingsStore.subscribe((state, previous) => {
    if (state.islandStyle !== previous.islandStyle || state.anchor !== previous.anchor) publish();
  });
}
