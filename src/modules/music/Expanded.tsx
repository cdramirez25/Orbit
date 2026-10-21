import { Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';

import { IconButton } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n/useT';
import { trackPosition } from '@/lib/media/track-position';
import { formatDuration } from '@/lib/utils/time';
import { useMediaStore } from '@/stores/media.store';
import type { NowPlaying } from '@/types';

/** Portada de la canción; sin ella, una nota musical. */
function Cover({ artwork }: { artwork: string | null }) {
  return (
    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/8">
      {artwork ? (
        <img src={artwork} alt="" className="size-full object-cover" />
      ) : (
        <Music2 aria-hidden className="size-7 text-accent" />
      )}
    </div>
  );
}

/** Barra de progreso (solo si la canción tiene duración). Se mueve una vez por segundo. */
function Progress({ track }: { track: NowPlaying }) {
  const t = useT();
  const now = useNow(1000);
  const position = trackPosition(track, now);
  if (position === null || track.duration === null) return null;

  return (
    <div className="mt-2.5 flex items-center gap-2 text-[11px] text-ink-faint tabular-nums">
      <span className="w-9 text-right">{formatDuration(position)}</span>
      <div
        role="progressbar"
        aria-label={t('music.progress')}
        aria-valuemin={0}
        aria-valuemax={Math.round(track.duration)}
        aria-valuenow={Math.round(position)}
        className="h-1 flex-1 overflow-hidden rounded-full bg-white/12"
      >
        <div
          className="h-full origin-left rounded-full bg-white/85 transition-transform duration-1000 ease-linear motion-reduce:transition-none"
          style={{ transform: `scaleX(${position / track.duration})` }}
        />
      </div>
      <span className="w-9">{formatDuration(track.duration)}</span>
    </div>
  );
}

/** Lo que suena y los controles básicos: anterior, play o pausa, siguiente. */
export function Expanded() {
  const t = useT();
  const nowPlaying = useMediaStore((s) => s.nowPlaying);
  const send = useMediaStore((s) => s.send);
  const playPause = useMediaStore((s) => s.playPause);

  if (!nowPlaying) {
    return (
      <div className="flex items-center gap-4 py-1">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-white/6">
          <Music2 aria-hidden className="size-7 text-ink-faint" />
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
        <Cover artwork={nowPlaying.artwork} />
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

      <Progress track={nowPlaying} />

      <div
        role="group"
        aria-label={t('music.controlsAria')}
        className="mt-2.5 flex items-center justify-center gap-3"
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
