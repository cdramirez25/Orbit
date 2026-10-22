import { translate, useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';

/** Rótulos del menú de la bandeja en el idioma activo (el menú es nativo: Rust no los conoce). */
export function trayLabels() {
  return {
    toggleIsland: translate('tray.toggleIsland'),
    settings: translate('tray.settings'),
    quit: translate('tray.quit'),
  };
}

/**
 * Crea el menú de la bandeja con los rótulos del idioma activo y lo vuelve a rotular cada vez que
 * el idioma cambia (también cuando se cambia desde la ventana de ajustes).
 */
export function bindTrayLabels(): () => void {
  const push = () => {
    commands.setTrayLabels(trayLabels()).catch(() => {
      // Sin bandeja (o sin respuesta) la app sigue funcionando.
    });
  };
  push();
  return useLocaleStore.subscribe((state, previous) => {
    if (state.locale !== previous.locale) push();
  });
}
