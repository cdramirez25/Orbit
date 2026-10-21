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
  'island.stretchAria': 'Alargar tarjeta',
  'island.shrink': 'Reducir',
  'island.shrinkAria': 'Reducir tarjeta',
  'island.settingsShow': 'Abrir ajustes',

  // ── Módulo de demo (contenido de ejemplo) ───────────────────────────────
  'demo.detected': 'Pregunta detectada',
  'demo.question': '¿Cuál es la capital de Australia?',
  'demo.answerShort': 'Canberra',
  'demo.answerLong':
    'Canberra. Muchos piensan que es Sídney o Melbourne, pero se eligió como capital en 1908 ' +
    'precisamente como punto medio entre ambas ciudades rivales. Se fundó en 1913 y el Parlamento ' +
    'se trasladó allí en 1927. Es la ciudad más grande del interior de Australia, y su nombre ' +
    'viene de una palabra aborigen que se suele traducir como "lugar de encuentro".',

  // ── Ventana de ajustes (solo en desarrollo) ─────────────────────────────
  'settings.panel.title': 'Ajustes',
  'settings.section.behavior': 'Comportamiento',
  'settings.section.appearance': 'Apariencia',
  'settings.section.language': 'Idioma',
  'settings.section.privacy': 'Privacidad',
  'settings.section.app': 'Aplicación',
  'settings.panel.state': 'Estado',
  'settings.panel.stateAria': 'Estado de la isla',
  'settings.panel.hidden': 'Oculto',
  'settings.panel.idle': 'Reposo',
  'settings.panel.compact': 'Compacto',
  'settings.panel.expanded': 'Expandido',
  'settings.panel.alert': 'Alerta',
  'settings.panel.style': 'Estilo',
  'settings.panel.styleAria': 'Estilo de la isla',
  'settings.panel.attached': 'Pegada',
  'settings.panel.floating': 'Flotante',
  'settings.panel.simulate': 'Simular respuesta',
  'settings.panel.hideFromShare': 'Ocultar al compartir pantalla',
  'settings.panel.hideFromShareAria': 'Ocultar la isla al compartir pantalla',
  'settings.panel.hideFromShareHint':
    'La isla no se ve cuando compartes pantalla, grabas o haces capturas.',
  'settings.panel.quit': 'Salir',
  'settings.panel.position': 'Posición',
  'settings.panel.positionAria': 'Posición de la isla',
  'settings.panel.left': 'Izquierda',
  'settings.panel.center': 'Centro',
  'settings.panel.right': 'Derecha',
  'settings.panel.free': 'Libre',
  'settings.panel.freeHint': 'arrastra la isla y suéltala',
  'settings.panel.languageAria': 'Idioma',
  'settings.panel.audio': 'Audio del sistema',

  // ── Permiso para capturar el audio del sistema ──────────────────────────
  'audio.permission.granted': 'Permitido',
  'audio.permission.denied': 'Denegado',
  'audio.permission.notDetermined': 'Sin pedir',
  'audio.permission.notRequired': 'No requerido',
  'audio.permission.request': 'Pedir permiso',
  'audio.permission.openSettings': 'Abrir ajustes',
  'audio.permission.restartHint': 'Reinicia Orbit tras darlo.',

  // ── Escucha del audio del sistema ───────────────────────────────────────
  'audio.listen': 'Escuchar',
  'audio.stop': 'Parar',
  'audio.error.noDevice': 'Sin dispositivo de salida',
  'audio.error.generic': 'No se pudo escuchar',

  // ── Transcripción en vivo ───────────────────────────────────────────────
  'transcript.title': 'Transcripción en vivo',
  'transcript.waiting': 'Esperando voz…',
  'transcript.sample1': 'La capital de Australia es Canberra, no Sídney como mucha gente cree.',
  'transcript.sample2': 'El río más largo del mundo es el Nilo según la mayoría de las fuentes.',
  'stt.error.modelMissing': 'Falta el modelo de transcripción',
  'stt.error.modelLoad': 'No se pudo cargar el modelo de transcripción',
  'stt.error.generic': 'Falló la transcripción',

  // ── Selector de módulos ─────────────────────────────────────────────────
  'modules.switcherAria': 'Módulos de la isla',
  'demo.module': 'Demo',

  // ── Clima ───────────────────────────────────────────────────────────────
  'weather.module': 'Clima',
  'weather.condition.clear': 'Despejado',
  'weather.condition.partlyCloudy': 'Parcialmente nublado',
  'weather.condition.cloudy': 'Nublado',
  'weather.condition.fog': 'Niebla',
  'weather.condition.drizzle': 'Llovizna',
  'weather.condition.rain': 'Lluvia',
  'weather.condition.snow': 'Nieve',
  'weather.condition.thunderstorm': 'Tormenta',
  'weather.feelsLike': 'Sensación',
  'weather.humidity': 'Humedad',
  'weather.wind': 'Viento',
  'weather.highLow': 'Máx. / Mín.',
  'weather.rainChance': 'Prob. lluvia',
  'weather.updatedAt': 'Actualizado a las',
  'weather.refresh': 'Actualizar clima',
  'weather.loading': 'Buscando el clima de tu zona…',
  'weather.error.network': 'Sin conexión para consultar el clima',
  'weather.error.generic': 'No se pudo obtener el clima',
  'weather.retry': 'Reintentar',

  // ── Historial del portapapeles ──────────────────────────────────────────
  'clipboard.module': 'Portapapeles',
  'clipboard.title': 'Historial',
  'clipboard.sessionHint': 'Solo de esta sesión: se borra al cerrar Orbit.',
  'clipboard.empty': 'Aún no has copiado nada en esta sesión.',
  'clipboard.copy': 'Copiar de nuevo',
  'clipboard.copied': 'Copiado',
  'clipboard.delete': 'Borrar este elemento',
  'clipboard.clear': 'Borrar todo',
  'clipboard.clearAria': 'Borrar todo el historial',
  'clipboard.text': 'Texto',
  'clipboard.image': 'Imagen',
  'clipboard.imageAlt': 'Imagen copiada',
  'clipboard.characters': 'caracteres',

  // ── Música ──────────────────────────────────────────────────────────────
  'music.module': 'Música',
  'music.playing': 'Sonando',
  'music.paused': 'En pausa',
  'music.empty': 'No suena nada ahora mismo.',
  'music.emptyHint': 'Reproduce algo en Spotify, Música o YouTube y aparecerá aquí.',
  'music.previous': 'Anterior',
  'music.next': 'Siguiente',
  'music.play': 'Reproducir',
  'music.pause': 'Pausar',
  'music.controlsAria': 'Controles de música',
  'music.progress': 'Progreso de la canción',
} as const;

/** Todas las claves de texto de la interfaz. */
export type MessageKey = keyof typeof es;
