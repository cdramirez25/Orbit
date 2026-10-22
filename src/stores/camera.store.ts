import { create } from 'zustand';

import { commands } from '@/ipc/commands';
import { captureSquare, cameraErrorKind, dataUrlToBase64 } from '@/lib/camera';
import type { CameraErrorKind, CameraStatus } from '@/types';

/** La foto que se acaba de tomar y lo que se hizo con ella. */
export interface CameraPhoto {
  /** La imagen (`data:image/png;base64,…`) para mostrarla. */
  dataUrl: string;
  /** Ya está en el portapapeles. */
  copied: boolean;
  /** Nombre del archivo si se guardó en Imágenes; `null` si no. */
  savedAs: string | null;
}

interface CameraStore {
  status: CameraStatus;
  /** Lo que llega de la cámara mientras está encendida. */
  stream: MediaStream | null;
  /** Por qué falló encenderla, si `status` es `error`. */
  errorKind: CameraErrorKind | null;
  photo: CameraPhoto | null;
  /** Qué falló al llevar la foto a su destino (portapapeles o carpeta). */
  photoError: 'copy' | 'save' | null;
  /** Pide la cámara al sistema (la primera vez sale su aviso de permiso). */
  start: () => Promise<void>;
  /** Apaga la cámara (la luz del equipo se apaga). La foto tomada se conserva. */
  stop: () => void;
  /** Apaga la cámara y olvida la foto: al cerrar la tarjeta no queda nada en memoria. */
  reset: () => void;
  /** Toma una foto del video, la pone en el portapapeles y la muestra. */
  snap: (video: HTMLVideoElement) => Promise<boolean>;
  /** Guarda la foto en la carpeta Imágenes. */
  save: () => Promise<void>;
  discardPhoto: () => void;
  openSettings: () => Promise<void>;
}

/** Número del último intento de encender: si se apaga mientras el sistema todavía pregunta, se descarta. */
let run = 0;

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export const useCameraStore = create<CameraStore>((set, get) => ({
  status: 'off',
  stream: null,
  errorKind: null,
  photo: null,
  photoError: null,

  start: async () => {
    const { status } = get();
    if (status === 'starting' || status === 'on') return;
    const attempt = ++run;
    set({ status: 'starting', errorKind: null });

    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!devices?.getUserMedia) {
      set({ status: 'error', errorKind: 'unavailable' });
      return;
    }
    try {
      const stream = await devices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      if (attempt !== run) {
        stopTracks(stream); // se apagó mientras el sistema preguntaba: que no quede encendida
        return;
      }
      set({ status: 'on', stream });
    } catch (error) {
      if (attempt !== run) return;
      set({ status: 'error', stream: null, errorKind: cameraErrorKind(error) });
    }
  },

  stop: () => {
    run += 1;
    stopTracks(get().stream);
    set({ status: 'off', stream: null, errorKind: null });
  },

  reset: () => {
    get().stop();
    set({ photo: null, photoError: null });
  },

  snap: async (video) => {
    const dataUrl = captureSquare(video);
    if (!dataUrl) return false;
    set({ photo: { dataUrl, copied: false, savedAs: null }, photoError: null });
    try {
      await commands.copyCameraPhoto(dataUrlToBase64(dataUrl));
      set((state) =>
        state.photo?.dataUrl === dataUrl ? { photo: { ...state.photo, copied: true } } : state,
      );
    } catch {
      set({ photoError: 'copy' });
    }
    return true;
  },

  save: async () => {
    const photo = get().photo;
    if (!photo) return;
    set({ photoError: null });
    try {
      const savedAs = await commands.saveCameraPhoto(dataUrlToBase64(photo.dataUrl));
      set((state) =>
        state.photo?.dataUrl === photo.dataUrl ? { photo: { ...state.photo, savedAs } } : state,
      );
    } catch {
      set({ photoError: 'save' });
    }
  },

  discardPhoto: () => set({ photo: null, photoError: null }),

  openSettings: async () => {
    try {
      await commands.openCameraSettings();
    } catch {
      // Si no se puede abrir, el usuario lo abre a mano: el mensaje ya dice dónde está.
    }
  },
}));
