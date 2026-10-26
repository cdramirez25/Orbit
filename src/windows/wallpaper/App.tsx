import { useEffect, useRef } from 'react';

import { isScreenPaused } from '@/lib/wallpaper';
import { useWallpaperStore } from '@/stores/wallpaper.store';

/** El video del fondo: en bucle, siempre sin sonido, y quieto mientras `paused`. */
function VideoLayer({ src, paused }: { src: string; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const requestPlay = useWallpaperStore((s) => s.requestPlay);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Sin sonido pase lo que pase: ni volumen ni pista de audio.
    element.muted = true;
    element.volume = 0;
    if (paused) {
      element.pause();
      return;
    }
    // macOS rechaza que un video empiece solo, aunque no tenga sonido: si pasa, la app lo pone a
    // reproducir por su cuenta (`requestPlay`).
    element.play().catch(() => void requestPlay());
  }, [src, paused, requestPlay]);

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
 * El fondo de pantalla de un monitor: la imagen o el video elegido a pantalla completa, o negro si no
 * hay nada. La pausa (a mano o por rendimiento) congela el video donde está.
 */
export function App() {
  const status = useWallpaperStore((s) => s.status);
  const url = useWallpaperStore((s) => s.url);
  const screen = useWallpaperStore((s) => s.screen);

  if (!status?.enabled || !url || !status.kind) {
    return <div className="fixed inset-0 bg-black" />;
  }
  if (status.kind === 'video') {
    return <VideoLayer src={url} paused={isScreenPaused(status, screen)} />;
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
