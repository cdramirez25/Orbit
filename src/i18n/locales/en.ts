import type { MessageKey } from '@/i18n/locales/es';

/**
 * English UI text. It must have exactly the same keys as `es.ts` (TypeScript enforces it).
 */
export const en: Record<MessageKey, string> = {
  // ── Island ──────────────────────────────────────────────────────────────
  'island.open': 'Open Orbit',
  'island.expand': 'Expand Orbit',
  'island.dismissAlert': 'Dismiss alert',
  'island.collapse': 'Collapse',
  'island.stretch': 'Extend',
  'island.stretchAria': 'Extend card',
  'island.shrink': 'Shrink',
  'island.shrinkAria': 'Shrink card',
  'island.settingsShow': 'Open settings',

  // ── Demo module (sample content) ────────────────────────────────────────
  'demo.detected': 'Question detected',
  'demo.question': 'What is the capital of Australia?',
  'demo.answerShort': 'Canberra',
  'demo.answerLong':
    'Canberra. Many people think it is Sydney or Melbourne, but it was chosen as the capital in ' +
    '1908 precisely as a midpoint between those two rival cities. It was founded in 1913 and ' +
    'Parliament moved there in 1927. It is the largest inland city in Australia, and its name ' +
    'comes from an Aboriginal word usually translated as "meeting place".',

  // ── Settings window (development only) ──────────────────────────────────
  'settings.panel.title': 'Settings',
  'settings.section.behavior': 'Behavior',
  'settings.section.appearance': 'Appearance',
  'settings.section.language': 'Language',
  'settings.section.privacy': 'Privacy',
  'settings.section.app': 'App',
  'settings.panel.state': 'State',
  'settings.panel.stateAria': 'Island state',
  'settings.panel.hidden': 'Hidden',
  'settings.panel.idle': 'Idle',
  'settings.panel.compact': 'Compact',
  'settings.panel.expanded': 'Expanded',
  'settings.panel.alert': 'Alert',
  'settings.panel.style': 'Style',
  'settings.panel.styleAria': 'Island style',
  'settings.panel.attached': 'Attached',
  'settings.panel.floating': 'Floating',
  'settings.panel.simulate': 'Simulate answer',
  'settings.panel.hideFromShare': 'Hide when sharing screen',
  'settings.panel.hideFromShareAria': 'Hide the island when sharing the screen',
  'settings.panel.hideFromShareHint':
    'The island is not visible when you share your screen, record or take screenshots.',
  'settings.panel.quit': 'Quit',
  'settings.panel.position': 'Position',
  'settings.panel.positionAria': 'Island position',
  'settings.panel.left': 'Left',
  'settings.panel.center': 'Center',
  'settings.panel.right': 'Right',
  'settings.panel.free': 'Free',
  'settings.panel.freeHint': 'drag the island and drop it',
  'settings.panel.languageAria': 'Language',
  'settings.panel.audio': 'System audio',

  // ── System audio capture permission ─────────────────────────────────────
  'audio.permission.granted': 'Granted',
  'audio.permission.denied': 'Denied',
  'audio.permission.notDetermined': 'Not requested',
  'audio.permission.notRequired': 'Not required',
  'audio.permission.request': 'Request access',
  'audio.permission.openSettings': 'Open settings',
  'audio.permission.restartHint': 'Restart Orbit after granting.',

  // ── System audio listening ──────────────────────────────────────────────
  'audio.listen': 'Listen',
  'audio.stop': 'Stop',
  'audio.error.noDevice': 'No output device',
  'audio.error.generic': 'Could not listen',

  // ── Live transcript ─────────────────────────────────────────────────────
  'transcript.title': 'Live transcript',
  'transcript.waiting': 'Waiting for speech…',
  'transcript.sample1': 'The capital of Australia is Canberra, not Sydney as many people think.',
  'transcript.sample2': 'The longest river in the world is the Nile according to most sources.',
  'stt.error.modelMissing': 'Transcription model not found',
  'stt.error.modelLoad': 'Could not load the transcription model',
  'stt.error.generic': 'Transcription failed',

  // ── Module switcher ─────────────────────────────────────────────────────
  'modules.switcherAria': 'Island modules',
  'demo.module': 'Demo',

  // ── Weather ─────────────────────────────────────────────────────────────
  'weather.module': 'Weather',
  'weather.condition.clear': 'Clear',
  'weather.condition.partlyCloudy': 'Partly cloudy',
  'weather.condition.cloudy': 'Cloudy',
  'weather.condition.fog': 'Fog',
  'weather.condition.drizzle': 'Drizzle',
  'weather.condition.rain': 'Rain',
  'weather.condition.snow': 'Snow',
  'weather.condition.thunderstorm': 'Thunderstorm',
  'weather.feelsLike': 'Feels like',
  'weather.humidity': 'Humidity',
  'weather.wind': 'Wind',
  'weather.highLow': 'High / Low',
  'weather.rainChance': 'Precip.',
  'weather.updatedAt': 'Updated at',
  'weather.refresh': 'Refresh weather',
  'weather.loading': 'Looking up the weather in your area…',
  'weather.error.network': 'No connection to fetch the weather',
  'weather.error.generic': 'Could not get the weather',
  'weather.retry': 'Retry',

  // ── Clipboard history ───────────────────────────────────────────────────
  'clipboard.module': 'Clipboard',
  'clipboard.title': 'History',
  'clipboard.sessionHint': 'This session only: cleared when Orbit quits.',
  'clipboard.empty': 'You have not copied anything in this session yet.',
  'clipboard.copy': 'Copy again',
  'clipboard.copied': 'Copied',
  'clipboard.delete': 'Delete this item',
  'clipboard.clear': 'Clear all',
  'clipboard.clearAria': 'Clear the whole history',
  'clipboard.text': 'Text',
  'clipboard.image': 'Image',
  'clipboard.imageAlt': 'Copied image',
  'clipboard.characters': 'characters',

  // ── Music ───────────────────────────────────────────────────────────────
  'music.module': 'Music',
  'music.playing': 'Now playing',
  'music.paused': 'Paused',
  'music.empty': 'Nothing is playing right now.',
  'music.emptyHint': 'Play something in Spotify, Music or YouTube and it will show up here.',
  'music.previous': 'Previous',
  'music.next': 'Next',
  'music.play': 'Play',
  'music.pause': 'Pause',
  'music.controlsAria': 'Music controls',
  'music.progress': 'Song progress',
};
