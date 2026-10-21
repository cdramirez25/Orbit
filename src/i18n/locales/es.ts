/**
 * Textos de la interfaz en español (idioma base).
 *
 * - Todo texto visible o accesible (`aria-label`, `title`…) va aquí, no dentro de los componentes.
 * - Estas claves definen `MessageKey`: `en.ts` debe tener exactamente las mismas o TypeScript no
 *   compila. Para añadir un idioma: crea `locales/<código>.ts` y regístralo en `messages.ts`.
 * - Claves en formato `zona.nombre` (`island.*`, `demo.*`, `settings.*`).
 */
export const es = {
  // ── Isla ────────────────────────────────────────────────────────────────
  'island.open': 'Abrir Orbit',
  'island.expand': 'Expandir Orbit',
  'island.dismissAlert': 'Cerrar aviso',
  'island.collapse': 'Contraer',
  'island.stretch': 'Alargar',
  'island.stretchAria': 'Alargar respuesta',
  'island.shrink': 'Reducir',
  'island.shrinkAria': 'Reducir respuesta',

  // ── Módulo de demo (contenido de ejemplo) ───────────────────────────────
  'demo.detected': 'Pregunta detectada',
  'demo.question': '¿Cuál es la capital de Australia?',
  'demo.answerShort': 'Canberra',
  'demo.answerLong':
    'Canberra. Muchos piensan que es Sídney o Melbourne, pero se eligió como capital en 1908 ' +
    'precisamente como punto medio entre ambas ciudades rivales. Se fundó en 1913 y el Parlamento ' +
    'se trasladó allí en 1927. Es la ciudad más grande del interior de Australia, y su nombre ' +
    'viene de una palabra aborigen que se suele traducir como "lugar de encuentro".',

  // ── Panel de demo (solo en desarrollo) ──────────────────────────────────
  'demo.controls.stateAria': 'Estado de la isla',
  'demo.controls.hidden': 'Oculto',
  'demo.controls.idle': 'Reposo',
  'demo.controls.compact': 'Compacto',
  'demo.controls.expanded': 'Expandido',
  'demo.controls.alert': 'Alerta',
  'demo.controls.styleAria': 'Estilo',
  'demo.controls.attached': 'Pegada',
  'demo.controls.floating': 'Flotante',
  'demo.controls.simulate': 'Simular respuesta',
  'demo.controls.hideFromShare': 'Oculta en share',
  'demo.controls.hideFromShareAria': 'Ocultar de screen share',
  'demo.controls.quit': 'Salir',
  'demo.controls.position': 'Posición',
  'demo.controls.positionAria': 'Posición de la isla',
  'demo.controls.left': 'Izquierda',
  'demo.controls.center': 'Centro',
  'demo.controls.right': 'Derecha',
  'demo.controls.free': 'Libre',
  'demo.controls.freeHint': 'arrastra la isla y suéltala',
  'demo.controls.languageAria': 'Idioma',
  'demo.controls.audio': 'Audio del sistema',

  // ── Permiso para capturar el audio del sistema ──────────────────────────
  'audio.permission.granted': 'Permitido',
  'audio.permission.denied': 'Denegado',
  'audio.permission.notDetermined': 'Sin pedir',
  'audio.permission.notRequired': 'No requerido',
  'audio.permission.request': 'Pedir permiso',
  'audio.permission.openSettings': 'Abrir ajustes',
  'audio.permission.restartHint': 'Tras darlo en Ajustes, reinicia Orbit.',

  // ── Ventana de ajustes ──────────────────────────────────────────────────
  'settings.placeholder': 'Ajustes de Orbit — próximamente (Fase 5).',
} as const;

/** Todas las claves de texto de la interfaz. */
export type MessageKey = keyof typeof es;
