import {
  AudioLines,
  MessagesSquare,
  PanelTop,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import type { MessageKey } from '@/i18n/messages';

export type SettingsPage = 'island' | 'sessions' | 'audio' | 'ai' | 'general';

export const SETTINGS_PAGES: ReadonlyArray<{
  id: SettingsPage;
  label: MessageKey;
  icon: LucideIcon;
}> = [
  { id: 'island', label: 'settings.nav.island', icon: PanelTop },
  { id: 'sessions', label: 'settings.nav.sessions', icon: MessagesSquare },
  { id: 'audio', label: 'settings.nav.audio', icon: AudioLines },
  { id: 'ai', label: 'settings.nav.ai', icon: Sparkles },
  { id: 'general', label: 'settings.nav.general', icon: SlidersHorizontal },
];
