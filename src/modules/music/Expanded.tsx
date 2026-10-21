import { Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { IconButton } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n/useT';
import { trackPosition } from '@/lib/media/track-position';
import { cn } from '@/lib/utils/cn';
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

/** Cuántos segundos mueven las flechas (y Re Pág / Av Pág) la barra de progreso. */
const SEEK_STEP = 5;
const SEEK_BIG_STEP = 15;
const KEY_SEEK: Record<string, number> = {
  ArrowLeft: -SEEK_STEP,
  ArrowDown: -SEEK_STEP,
  ArrowRight: SEEK_STEP,
  ArrowUp: SEEK_STEP,
  PageDown: -SEEK_BIG_STEP,
  PageUp: SEEK_BIG_STEP,
};

/**
 * Barra de progreso (solo si la canción tiene duración). Se mueve una vez por segundo y sirve para
 * saltar: se pulsa o se arrastra (el salto se manda al soltar) y se maneja con el teclado.
 */
function Progress({ track }: { track: NowPlaying }) {
  const t = useT();
  const seek = useMediaStore((s) => s.seek);
  const now = useNow(1000);
  const barRef = useRef<HTMLDivElement>(null);
  // Mientras se arrastra: fracción (0–1) a la que apunta el puntero. `null` = no se arrastra.
  const [dragging, setDragging] = useState<number | null>(null);
  const position = trackPosition(track, now);
  if (position === null || track.duration === null) return null;
  const duration = track.duration;

  const fractionAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const shown = dragging === null ? position : dragging * duration;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(fractionAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging !== null) setDragging(fractionAt(event.clientX));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging === null) return;
    setDragging(null);
    void seek(fractionAt(event.clientX) * duration);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_SEEK[event.key];
    if (step !== undefined) {
      event.preventDefault();
      void seek(position + step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      void seek(0);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-faint tabular-nums">
      <span className="w-9 text-right">{formatDuration(shown)}</span>
      {/* La zona pulsable es más alta que la barra para que sea fácil acertar. */}
      <div
        role="slider"
        tabIndex={0}
        data-clickable=""
        aria-label={t('music.progress')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${formatDuration(shown)} / ${formatDuration(duration)}`}
        className="group flex h-5 flex-1 touch-none items-center outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragging(null)}
        onKeyDown={onKeyDown}
      >
        <div
          ref={barRef}
          className={cn(
            'w-full overflow-hidden rounded-full bg-white/12 transition-[height] duration-150',
            'h-1 group-hover:h-1.5 group-focus-visible:h-1.5',
            dragging !== null && 'h-1.5',
          )}
        >
          <div
            className={cn(
              'h-full origin-left rounded-full bg-white/85',
              dragging === null &&
                'transition-transform duration-1000 ease-linear motion-reduce:transition-none',
            )}
            style={{ transform: `scaleX(${shown / duration})` }}
          />
        </div>
      </div>
      <span className="w-9">{formatDuration(duration)}</span>
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
