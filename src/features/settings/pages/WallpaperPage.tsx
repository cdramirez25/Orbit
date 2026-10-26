import {
  Check,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button, Select, Tab, Toggle } from '@/components/ui';
import { Field, PageHeader, Section } from '@/features/settings/layout';
import { SoundOutputSelect } from '@/features/settings/pages/SoundOutputSelect';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { pauseReason, screenLabel, soundSupport, targetScreen } from '@/lib/wallpaper';
import { cn } from '@/lib/utils/cn';
import { useWallpaperStore, type WallpaperEntry } from '@/stores/wallpaper.store';
import type { PerformanceMode } from '@/types';

/** Cuánto se espera sin mover el volumen antes de mandarlo (así arrastrar no manda una orden por píxel). */
const VOLUME_DEBOUNCE_MS = 150;

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

function Card({
  item,
  selected,
  screen,
}: {
  item: WallpaperEntry;
  selected: boolean;
  /** El monitor al que se aplica al elegirlo; `null` = todos. */
  screen: string | null;
}) {
  const t = useT();
  const select = useWallpaperStore((s) => s.select);
  const Icon = item.kind === 'video' ? Film : ImageIcon;

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${t('wallpaper.use')} ${item.file}`}
      onClick={() => void select(item.file, screen)}
      className={cn(
        'relative aspect-video overflow-hidden rounded-xl bg-white/6 text-left outline-none',
        'focus-visible:ring-2 focus-visible:ring-white/60',
        selected ? 'ring-2 ring-accent' : 'hover:ring-1 hover:ring-white/30',
      )}
    >
      <Thumbnail item={item} />
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 pt-4 pb-1 text-[10px] text-white">
        <Icon aria-hidden className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.file}</span>
        {item.hasAudio === true && (
          <span title={t('wallpaper.hasAudio')} className="shrink-0">
            <Volume2 aria-label={t('wallpaper.hasAudio')} className="size-3" />
          </span>
        )}
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

/** El volumen de los videos con sonido. Arrastrarlo se nota al instante; a Rust llega ya asentado. */
function VolumeSlider({ volume, disabled }: { volume: number; disabled: boolean }) {
  const t = useT();
  const setVolume = useWallpaperStore((s) => s.setVolume);
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(volume);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const change = (value: number) => {
    latest.current = value;
    setDraft(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void setVolume(value).then(() => {
        if (latest.current === value) setDraft(null);
      });
    }, VOLUME_DEBOUNCE_MS);
  };
  const shown = draft ?? volume;

  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        disabled={disabled}
        aria-label={t('wallpaper.sound.volumeAria')}
        onChange={(event) => change(Number(event.target.value))}
        className="h-1 min-w-0 flex-1 accent-accent"
      />
      <span className="w-9 shrink-0 text-right text-[11px] text-ink-dim tabular-nums">
        {shown}%
      </span>
    </div>
  );
}

/**
 * Fondo de pantalla animado: eliges una imagen o un video de la carpeta de fondos y se dibuja detrás
 * de los iconos del escritorio. Se puede pausar, los videos van sin sonido salvo que se active (y solo
 * si traen audio), con varios monitores se elige el mismo fondo en todos o uno en cada uno, y el modo
 * rendimiento lo pausa solo cuando hay ventanas abiertas encima.
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
  const setPerScreen = useWallpaperStore((s) => s.setPerScreen);
  const setSound = useWallpaperStore((s) => s.setSound);
  const openFolder = useWallpaperStore((s) => s.openFolder);
  const addFiles = useWallpaperStore((s) => s.addFiles);

  // La carpeta es del usuario: al abrir la página y al volver a esta ventana se vuelve a leer.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // El monitor que se está configurando: con un fondo por monitor, el que se elija arriba.
  const [picked, setPicked] = useState<string | null>(null);
  const target = status ? targetScreen(status, picked) : null;
  const targetIndex = status && target ? status.screens.indexOf(target) : 0;
  const perScreen = status?.perScreen ?? false;
  const targetKey = perScreen ? (target?.key ?? null) : null;
  const showScreens = status !== null && (status.screens.length > 1 || perScreen);
  const support = soundSupport(target);
  const canHear = support === 'ready' || support === 'unknown';
  const soundOn = target?.sound ?? status?.sound ?? false;
  const soundHint: MessageKey | null =
    support === 'noVideo'
      ? 'wallpaper.sound.needVideo'
      : support === 'noAudio'
        ? 'wallpaper.sound.noAudio'
        : support === 'unknown'
          ? 'wallpaper.sound.unknown'
          : null;

  const reason = status ? pauseReason(status) : null;
  const canShow = status?.screens.some((screen) => screen.path !== null) ?? false;
  const anyMissing = status?.screens.some((screen) => screen.missing) ?? false;
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
            {t('wallpaper.performance.hint')}
          </p>
        </Section>

        {showScreens && status && (
          <Section title={t('wallpaper.section.screens')}>
            <div
              className="flex flex-wrap items-center gap-1"
              role="tablist"
              aria-label={t('wallpaper.screens.modeAria')}
            >
              <Tab selected={!perScreen} onClick={() => void setPerScreen(false)}>
                {t('wallpaper.screens.same')}
              </Tab>
              <Tab selected={perScreen} onClick={() => void setPerScreen(true)}>
                {t('wallpaper.screens.each')}
              </Tab>
            </div>
            {perScreen && (
              <Field label={t('wallpaper.screens.pick')}>
                <div
                  className="flex flex-wrap items-center gap-1"
                  role="tablist"
                  aria-label={t('wallpaper.screens.pickAria')}
                >
                  {status.screens.map((screen, index) => (
                    <Tab
                      key={screen.key}
                      selected={target?.key === screen.key}
                      onClick={() => setPicked(screen.key)}
                    >
                      {screenLabel(screen, index, t('wallpaper.screens.monitor'))}
                    </Tab>
                  ))}
                </div>
              </Field>
            )}
            <p className="text-[11px] leading-snug text-ink-faint">
              {t(perScreen ? 'wallpaper.screens.hintEach' : 'wallpaper.screens.hintSame')}
            </p>
          </Section>
        )}

        <Section title={t('wallpaper.section.library')}>
          {items.length === 0 ? (
            <p className="rounded-xl bg-white/6 p-3 text-[12px] leading-snug text-ink-dim">
              {t('wallpaper.empty')}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {items.map((item) => (
                <Card
                  key={item.file}
                  item={item}
                  selected={target?.file === item.file}
                  screen={targetKey}
                />
              ))}
            </div>
          )}

          {anyMissing && (
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

        <Section title={t('wallpaper.section.sound')}>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[12px] text-ink">
              <Toggle
                label={t('wallpaper.sound.enableAria')}
                checked={soundOn}
                disabled={!canHear}
                onCheckedChange={(sound) => void setSound(sound, targetKey)}
              />
              {t('wallpaper.sound.enable')}
            </label>
            {perScreen && target && (
              <span className="truncate rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-ink-dim">
                {screenLabel(target, targetIndex, t('wallpaper.screens.monitor'))}
              </span>
            )}
          </div>
          <VolumeSlider volume={status?.volume ?? 0} disabled={!canHear || !soundOn} />
          <SoundOutputSelect />
          <p className="text-[11px] leading-snug text-ink-faint">
            {soundHint ? t(soundHint) : t('wallpaper.sound.hint')}
          </p>
          <p className="text-[11px] leading-snug text-ink-faint">{t('soundOutput.hint')}</p>
        </Section>
      </div>
    </>
  );
}
