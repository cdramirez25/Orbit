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

  // ── Demo module (sample content) ────────────────────────────────────────
  'demo.detected': 'Question detected',
  'demo.question': 'What is the capital of Australia?',
  'demo.answerShort': 'Canberra',
  'demo.answerLong':
    'Canberra. Many people think it is Sydney or Melbourne, but it was chosen as the capital in ' +
    '1908 precisely as a midpoint between those two rival cities. It was founded in 1913 and ' +
    'Parliament moved there in 1927. It is the largest inland city in Australia, and its name ' +
    'comes from an Aboriginal word usually translated as "meeting place".',

  // ── Demo panel (development only) ───────────────────────────────────────
  'demo.controls.stateAria': 'Island state',
  'demo.controls.hidden': 'Hidden',
  'demo.controls.idle': 'Idle',
  'demo.controls.compact': 'Compact',
  'demo.controls.expanded': 'Expanded',
  'demo.controls.alert': 'Alert',
  'demo.controls.styleAria': 'Style',
  'demo.controls.attached': 'Attached',
  'demo.controls.floating': 'Floating',
  'demo.controls.simulate': 'Simulate answer',
  'demo.controls.hideFromShare': 'Hide on share',
  'demo.controls.hideFromShareAria': 'Hide from screen share',
  'demo.controls.quit': 'Quit',
  'demo.controls.position': 'Position',
  'demo.controls.positionAria': 'Island position',
  'demo.controls.left': 'Left',
  'demo.controls.center': 'Center',
  'demo.controls.right': 'Right',
  'demo.controls.free': 'Free',
  'demo.controls.freeHint': 'drag the island and drop it',
  'demo.controls.languageAria': 'Language',
  'demo.controls.audio': 'System audio',

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

  // ── Settings window ─────────────────────────────────────────────────────
  'settings.placeholder': 'Orbit settings — coming soon (Phase 5).',
};
