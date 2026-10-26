import { useEffect, useRef } from 'react';

import { isScreenPaused, screenOf } from '@/lib/wallpaper';
import { useWallpaperStore } from '@/stores/wallpaper.store';

/** Si pasado este tiempo un video que debería moverse sigue quieto, se vuelve a lanzar. */
const RESUME_CHECK_MS = 400;

interface VideoLayerProps {
  src: string;
  paused: boolean;
  /** ¿Con sonido? Solo cuando el usuario lo pidió y este monitor es el que lo reproduce. */
  audible: boolean;
  /** Volumen de 0 a 100 (solo cuenta si `audible`). */
  volume: number;
}

/** El video del fondo: en bucle, sin sonido salvo que se pida, y quieto mientras `paused`. */
function VideoLayer({ src, paused, audible, volume }: VideoLayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const requestPlay = useWallpaperStore((s) => s.requestPlay);

  // El sonido: apagado por defecto, ni volumen ni pista de audio.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = !audible;
    element.volume = audible ? Math.min(1, Math.max(0, volume / 100)) : 0;
  }, [src, audible, volume]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused) {
      element.pause();
      return;
    }
    // macOS rechaza que un video empiece solo (y, con sonido, que se quite el silencio sin que el
    // usuario toque nada): si pasa, la app lo pone a reproducir por su cuenta (`requestPlay`).
    element.play().catch(() => void requestPlay());
    // Red de seguridad: si el sistema lo dejó quieto sin avisar, se vuelve a lanzar una vez.
    const check = window.setTimeout(() => {
      if (element.paused) element.play().catch(() => void requestPlay());
    }, RESUME_CHECK_MS);
    return () => window.clearTimeout(check);
  }, [src, paused, audible, requestPlay]);

  return (
    <video
      ref={video}
      key={src}
      src={src}
      aria-hidden
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      tabIndex={-1}
      className="fixed inset-0 size-full object-cover"
    />
  );
}

/**
 * El fondo de pantalla de un monitor: la imagen o el video que le toca a este monitor a pantalla
 * completa, o negro si no hay nada. La pausa (a mano o por rendimiento) congela el video donde está.
 */
export function App() {
  const status = useWallpaperStore((s) => s.status);
  const url = useWallpaperStore((s) => s.url);
  const screen = useWallpaperStore((s) => s.screen);

  const mine = status ? screenOf(status, screen) : null;
  if (!status?.enabled || !url || !mine?.kind) {
    return <div className="fixed inset-0 bg-black" />;
  }
  if (mine.kind === 'video') {
    return (
      <VideoLayer
        src={url}
        paused={isScreenPaused(status, screen)}
        audible={mine.audible}
        volume={status.volume}
      />
    );
  }
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      className="fixed inset-0 size-full object-cover select-none"
    />
  );
}
