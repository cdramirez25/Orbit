import type { IslandAnchor, IslandState, IslandStyle } from '@/types/island';
import type { Locale } from '@/types/i18n';

/**
 * La ventana de ajustes es otra ventana (otro webview, con sus propios stores). Maneja la isla a
 * distancia con estos mensajes: ella manda órdenes y la isla le devuelve su estado.
 */
export type RemoteCommand =
  | { type: 'goTo'; state: IslandState }
  | { type: 'alert' }
  | { type: 'simulate' }
  | { type: 'setStyle'; style: IslandStyle }
  | { type: 'setAnchor'; anchor: IslandAnchor }
  | { type: 'setLocale'; locale: Locale };

/** Lo que la ventana de ajustes necesita saber de la isla para mostrarlo. */
export interface RemoteState {
  islandState: IslandState;
  style: IslandStyle;
  anchor: IslandAnchor;
}
