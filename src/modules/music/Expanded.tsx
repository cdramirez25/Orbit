import { Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';

import { IconButton } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { useMediaStore } from '@/stores/media.store';

/** Lo que suena y los controles básicos: anterior, play o pausa, siguiente. */
export function Expanded() {
  const t = useT();
  const nowPlaying = useMediaStore((s) => s.nowPlaying);
  const send = useMediaStore((s) => s.send);
  const playPause = useMediaStore((s) => s.playPause);

  if (!nowPlaying) {
    return (
      <div className="flex items-center gap-4 py-1">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-white/6">
          <Music2 aria-hidden className="size-6 text-ink-faint" />
        </div>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-ink">{t('music.empty')}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-dim">{t('music.emptyHint')}</p>
        </div>
      </div>
    );
  }

  const PlayPauseIcon = nowPlaying.playing ? Pause : Play;

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-white/8">
          <Music2 aria-hidden className="size-6 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">
            {t(nowPlaying.playing ? 'music.playing' : 'music.paused')}
          </p>
          <p className="line-clamp-2 text-[15px] leading-snug font-semibold break-words text-ink">
            {nowPlaying.title}
          </p>
          {nowPlaying.artist && (
            <p className="truncate text-[12px] text-ink-dim">{nowPlaying.artist}</p>
          )}
        </div>
      </div>

      <div
        role="group"
        aria-label={t('music.controlsAria')}
        className="mt-3 flex items-center justify-center gap-3"
      >
        <IconButton
          label={t('music.previous')}
          className="size-9"
          onClick={() => void send('previous')}
        >
          <SkipBack aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          label={t(nowPlaying.playing ? 'music.pause' : 'music.play')}
          className="size-11 bg-white text-black hover:bg-white/85 hover:text-black active:bg-white/70"
          onClick={() => void playPause()}
        >
          <PlayPauseIcon aria-hidden className="size-5 fill-current" />
        </IconButton>
        <IconButton label={t('music.next')} className="size-9" onClick={() => void send('next')}>
          <SkipForward aria-hidden className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
