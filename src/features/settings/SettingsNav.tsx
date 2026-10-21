import { NavItem } from '@/components/ui';
import { SETTINGS_PAGES, type SettingsPage } from '@/features/settings/settingsPages';
import { useT } from '@/i18n/useT';

/** Barra de navegación lateral de la ventana de ajustes. */
export function SettingsNav({
  page,
  onSelect,
}: {
  page: SettingsPage;
  onSelect: (page: SettingsPage) => void;
}) {
  const t = useT();

  return (
    <nav
      aria-label={t('settings.nav.aria')}
      className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-white/8 bg-black/25 px-2 py-3"
    >
      {SETTINGS_PAGES.map(({ id, label, icon: Icon }) => (
        <NavItem key={id} current={page === id} onClick={() => onSelect(id)}>
          <Icon aria-hidden className="size-3.5 shrink-0" />
          {t(label)}
        </NavItem>
      ))}
    </nav>
  );
}
