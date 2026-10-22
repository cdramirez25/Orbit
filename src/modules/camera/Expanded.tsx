import { Camera, CameraOff, Check, Download, Loader2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { Button, IconButton } from '@/components/ui';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { CAMERA, CONTENT, REDUCED_MOTION } from '@/lib/island/island.motion';
import { cn } from '@/lib/utils/cn';
import { useCameraStore } from '@/stores/camera.store';
import type { CameraErrorKind } from '@/types';

const ERROR_TEXT: Record<CameraErrorKind, MessageKey> = {
  denied: 'camera.error.denied',
  notFound: 'camera.error.notFound',
  busy: 'camera.error.busy',
  unavailable: 'camera.error.unavailable',
  unknown: 'camera.error.unknown',
};

/** La vista previa cuadrada: mientras el sistema responde se ve vacía y luego aparece la imagen (en espejo). */
function Preview({
  videoRef,
  flash,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  flash: number;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const status = useCameraStore((s) => s.status);
  const stream = useCameraStore((s) => s.stream);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.srcObject = stream;
  }, [stream, status, videoRef]);

  const duration = reduced ? REDUCED_MOTION.fadeDuration : CAMERA.previewDuration;

  return (
    <motion.div
      // Entra con un fundido y un pequeño crecimiento mientras la isla se estira para recibirla.
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: CAMERA.previewScaleFrom }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration, ease: [...CONTENT.ease] }}
      className="relative shrink-0 overflow-hidden rounded-2xl bg-white/6"
      style={{ width: CAMERA.previewSize, height: CAMERA.previewSize }}
    >
      {status === 'on' ? (
        <video
          ref={videoRef}
          aria-label={t('camera.preview.aria')}
          autoPlay
          playsInline
          muted
          className="size-full [transform:scaleX(-1)] object-cover"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 text-ink-dim">
          <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
          <span role="status" className="text-[11px]">
            {t('camera.status.starting')}
          </span>
        </div>
      )}
      {flash > 0 && (
        <motion.div
          key={flash}
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-white"
          initial={{ opacity: reduced ? 0 : CAMERA.flashOpacity }}
          animate={{ opacity: 0 }}
          transition={{ duration: CAMERA.flashDuration, ease: [...CONTENT.ease] }}
        />
      )}
    </motion.div>
  );
}

/** La foto que se acaba de tomar y lo que se puede hacer con ella. */
function PhotoRow() {
  const t = useT();
  const photo = useCameraStore((s) => s.photo);
  const photoError = useCameraStore((s) => s.photoError);
  const save = useCameraStore((s) => s.save);
  const discard = useCameraStore((s) => s.discardPhoto);
  if (!photo) return null;

  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white/6 p-1.5">
      <img
        src={photo.dataUrl}
        alt={t('camera.photo.aria')}
        className="size-11 shrink-0 rounded-lg object-cover"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1 text-[11px] font-medium text-accent">
          {(photo.copied || photo.savedAs) && <Check aria-hidden className="size-3" />}
          {photo.savedAs
            ? t('camera.photo.saved')
            : photo.copied
              ? t('camera.photo.copied')
              : t('camera.photo.copying')}
        </span>
        <div className="flex items-center gap-1">
          {!photo.savedAs && (
            <Button size="sm" onClick={() => void save()}>
              <Download aria-hidden className="size-3" />
              {t('camera.action.save')}
            </Button>
          )}
          <IconButton label={t('camera.action.discard')} className="size-6" onClick={discard}>
            <X aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      </div>
      {photoError && (
        <span role="alert" className="sr-only">
          {t(photoError === 'copy' ? 'camera.photo.copyFailed' : 'camera.photo.saveFailed')}
        </span>
      )}
    </div>
  );
}

/**
 * La tarjeta de la cámara: un espejo para verte antes de una llamada y una foto rápida. La cámara
 * está apagada hasta que se pulsa "Encender" y se apaga sola al cerrar la tarjeta, cambiar de
 * módulo u ocultar la isla: la luz del equipo no se queda prendida.
 */
export function Expanded() {
  const t = useT();
  const status = useCameraStore((s) => s.status);
  const errorKind = useCameraStore((s) => s.errorKind);
  const photoError = useCameraStore((s) => s.photoError);
  const hasPhoto = useCameraStore((s) => s.photo !== null);
  const start = useCameraStore((s) => s.start);
  const stop = useCameraStore((s) => s.stop);
  const reset = useCameraStore((s) => s.reset);
  const snap = useCameraStore((s) => s.snap);
  const openSettings = useCameraStore((s) => s.openSettings);
  const [flash, setFlash] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Si la ventana se oculta con la cámara encendida, se apaga.
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      reset();
    };
  }, [stop, reset]);

  const showPreview = status === 'starting' || status === 'on';

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (await snap(video)) setFlash((n) => n + 1);
  };

  return (
    <div className="flex items-start gap-4">
      {showPreview && <Preview videoRef={videoRef} flash={flash} />}

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">
            {t('camera.module')}
          </span>
          <span
            role="status"
            className={cn(
              'rounded-full bg-white/8 px-2 py-0.5 text-[10px]',
              status === 'on' ? 'text-accent' : 'text-ink-dim',
            )}
          >
            {t(status === 'on' ? 'camera.status.on' : 'camera.status.off')}
          </span>
        </div>

        {!showPreview && status !== 'error' && (
          <p className="text-[13px] leading-snug text-ink-dim">{t('camera.intro')}</p>
        )}

        {status === 'error' && errorKind && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-[12px] leading-snug text-danger">
              {t(ERROR_TEXT[errorKind])}
            </p>
            {errorKind === 'denied' && (
              <Button size="sm" className="self-start" onClick={() => void openSettings()}>
                {t('camera.action.settings')}
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {status === 'on' && (
            <Button size="sm" variant="primary" onClick={() => void takePhoto()}>
              <Camera aria-hidden className="size-3" />
              {t('camera.action.snap')}
            </Button>
          )}
          {showPreview ? (
            <Button size="sm" onClick={stop}>
              <CameraOff aria-hidden className="size-3" />
              {t('camera.action.off')}
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void start()}>
              <Camera aria-hidden className="size-3" />
              {t('camera.action.on')}
            </Button>
          )}
        </div>

        {hasPhoto && <PhotoRow />}
        {photoError && !hasPhoto && (
          <span role="alert" className="text-[11px] text-danger">
            {t(photoError === 'copy' ? 'camera.photo.copyFailed' : 'camera.photo.saveFailed')}
          </span>
        )}
        <p className="text-[11px] leading-snug text-ink-faint">{t('camera.privacy')}</p>
      </div>
    </div>
  );
}
