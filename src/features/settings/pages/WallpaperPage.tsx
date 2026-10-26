import {
  Check,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Pause,
  Play,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useEffect } from 'react';

import { Button, Select, Toggle } from '@/components/ui';
import { PageHeader, Section } from '@/features/settings/layout';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { pauseReason } from '@/lib/wallpaper';
import { cn } from '@/lib/utils/cn';
import { useWallpaperStore, type WallpaperEntry } from '@/stores/wallpaper.store';
import type { PerformanceMode } from '@/types';

const PERFORMANCE_OPTIONS: ReadonlyArray<{ id: PerformanceMode; label: MessageKey }> = [
  { id: 'any', label: 'wallpaper.performance.any' },
  { id: 'large', label: 'wallpaper.performance.large' },
  { id: 'off', label: 'wallpaper.performance.off' },
];

function errorKey(code: string): MessageKey {
  switch (code) {
    case 'wallpaper.notFound':
      return 'wallpaper.error.notFound';
    case 'wallpaper.surface':
      return 'wallpaper.error.surface';
    case 'wallpaper.copy':
      return 'wallpaper.error.copy';
    case 'wallpaper.openFolder':
      return 'wallpaper.error.openFolder';
    default:
      return 'wallpaper.error.generic';
  }
}

/** La miniatura de un fondo: la propia imagen o el primer cuadro del video (sin sonido ni movimiento). */
function Thumbnail({ item }: { item: WallpaperEntry }) {
  const src = item.url;
  if (item.kind === 'image') {
    return <img src={src} alt="" aria-hidden loading="lazy" className="size-full object-cover" />;
  }
  return (
    <video
      src={`${src}#t=0.1`}
      aria-hidden
      muted
      playsInline
      preload="metadata"
      tabIndex={-1}
      className="size-full object-cover"
    />
  );
}

function Card({ item, selected }: { item: WallpaperEntry; selected: boolean }) {
  const t = useT();
  const select = useWallpaperStore((s) => s.select);
  const Icon = item.kind === 'video' ? Film : ImageIcon;

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${t('wallpaper.use')} ${item.file}`}
      onClick={() => void select(item.file)}
      className={cn(
        'relative aspect-video overflow-hidden rounded-xl bg-white/6 text-left outline-none',
        'focus-visible:ring-2 focus-visible:ring-white/60',
        selected ? 'ring-2 ring-accent' : 'hover:ring-1 hover:ring-white/30',
      )}
    >
      <Thumbnail item={item} />
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 pt-4 pb-1 text-[10px] text-white">
        <Icon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{item.file}</span>
      </span>
      {selected && (
        <span
          title={t('wallpaper.selected')}
          className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-black"
        >
          <Check aria-hidden className="size-3" />
        </span>
      )}
    </button>
  );
}

/**
 * Fondo de pantalla animado: eliges una imagen o un video de la carpeta de fondos y se dibuja detrás
 * de los iconos del escritorio. Se puede pausar, siempre va sin sonido y el modo rendimiento lo pausa
 * solo cuando hay ventanas abiertas encima.
 */
export function WallpaperPage() {
  const t = useT();
  const status = useWallpaperStore((s) => s.status);
  const items = useWallpaperStore((s) => s.items);
  const errorCode = useWallpaperStore((s) => s.errorCode);
  const adding = useWallpaperStore((s) => s.adding);
  const refresh = useWallpaperStore((s) => s.refresh);
  const setEnabled = useWallpaperStore((s) => s.setEnabled);
  const setPaused = useWallpaperStore((s) => s.setPaused);
  const setPerformance = useWallpaperStore((s) => s.setPerformance);
  const openFolder = useWallpaperStore((s) => s.openFolder);
  const addFiles = useWallpaperStore((s) => s.addFiles);

  // La carpeta es del usuario: al abrir la página y al volver a esta ventana se vuelve a leer.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const reason = status ? pauseReason(status) : null;
  const canShow = status !== null && status.file !== null && !status.missing;
  const stateText: MessageKey = !status?.enabled
    ? 'wallpaper.status.off'
    : reason === 'manual'
      ? 'wallpaper.status.pausedManual'
      : reason === 'performance'
        ? 'wallpaper.status.pausedPerformance'
        : 'wallpaper.status.on';
  const failure = errorCode ?? status?.error ?? null;

  return (
    <>
      <PageHeader title={t('settings.nav.wallpaper')} />
      <div className="flex flex-col gap-3">
        <Section title={t('wallpaper.section.show')}>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[12px] text-ink">
              <Toggle
                label={t('wallpaper.enableAria')}
                checked={status?.enabled ?? false}
                disabled={!canShow && !(status?.enabled ?? false)}
                onCheckedChange={(enabled) => void setEnabled(enabled)}
              />
              {t('wallpaper.enable')}
            </label>
            <span
              role="status"
              className={cn(
                'rounded-full bg-white/8 px-2 py-0.5 text-[11px]',
                stateText === 'wallpaper.status.on' ? 'text-accent' : 'text-ink-dim',
              )}
            >
              {t(stateText)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!status?.enabled}
              onClick={() => void setPaused(!status?.manualPause)}
            >
              {status?.manualPause ? (
                <Play aria-hidden className="size-3" />
              ) : (
                <Pause aria-hidden className="size-3" />
              )}
              {t(status?.manualPause ? 'wallpaper.resume' : 'wallpaper.pause')}
            </Button>
            <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-ink-dim">
              <span className="shrink-0">{t('wallpaper.performance.label')}</span>
              <Select
                value={status?.performance ?? 'any'}
                onChange={(event) => void setPerformance(event.target.value as PerformanceMode)}
              >
                {PERFORMANCE_OPTIONS.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {t(label)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <p className="text-[11px] leading-snug text-ink-faint">
            {t('wallpaper.performance.hint')} {t('wallpaper.silent')}
          </p>
        </Section>

        <Section title={t('wallpaper.section.library')}>
          {items.length === 0 ? (
            <p className="rounded-xl bg-white/6 p-3 text-[12px] leading-snug text-ink-dim">
              {t('wallpaper.empty')}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {items.map((item) => (
                <Card key={item.file} item={item} selected={status?.file === item.file} />
              ))}
            </div>
          )}

          {status?.missing && (
            <span role="alert" className="text-[11px] text-danger">
              {t('wallpaper.missing')}
            </span>
          )}
          {failure && (
            <span role="alert" className="text-[11px] text-danger">
              {t(errorKey(failure))}
            </span>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-dim">{t('wallpaper.folder')}</span>
            <div className="flex flex-wrap items-center gap-1">
              <span
                title={status?.folder}
                className="max-w-full min-w-0 truncate rounded-md bg-white/8 px-2 py-0.5 text-[11px] text-ink-dim"
              >
                {status?.folder ?? '…'}
              </span>
              <Button size="sm" onClick={() => void openFolder()}>
                <FolderOpen aria-hidden className="size-3" />
                {t('wallpaper.openFolder')}
              </Button>
              <Button
                size="sm"
                disabled={adding}
                onClick={() => void addFiles(t('wallpaper.addTitle'))}
              >
                <Plus aria-hidden className="size-3" />
                {t('wallpaper.add')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                <RefreshCw aria-hidden className="size-3" />
                {t('wallpaper.refresh')}
              </Button>
            </div>
          </div>
          <p className="text-[11px] leading-snug text-ink-faint">{t('wallpaper.hint')}</p>
        </Section>
      </div>
    </>
  );
}
