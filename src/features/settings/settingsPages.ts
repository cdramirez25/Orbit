import { AudioLines, PanelTop, SlidersHorizontal, Sparkles, type LucideIcon } from 'lucide-react';

import type { MessageKey } from '@/i18n/messages';

export type SettingsPage = 'island' | 'audio' | 'ai' | 'general';

export const SETTINGS_PAGES: ReadonlyArray<{
  id: SettingsPage;
  label: MessageKey;
  icon: LucideIcon;
}> = [
  { id: 'island', label: 'settings.nav.island', icon: PanelTop },
  { id: 'audio', label: 'settings.nav.audio', icon: AudioLines },
  { id: 'ai', label: 'settings.nav.ai', icon: Sparkles },
  { id: 'general', label: 'settings.nav.general', icon: SlidersHorizontal },
];
