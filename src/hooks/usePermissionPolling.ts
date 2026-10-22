import { useEffect } from 'react';

import { useAudioStore } from '@/stores/audio.store';

/** Cada cuánto se vuelve a consultar el permiso (el usuario lo concede en Ajustes del Sistema). */
const PERMISSION_POLL_MS = 2000;

/** Consulta el permiso de audio al abrirse y lo sigue consultando mientras la pantalla está a la vista. */
export function usePermissionPolling(): void {
  const refreshPermission = useAudioStore((s) => s.refresh);
  useEffect(() => {
    void refreshPermission();
    const timer = setInterval(() => void refreshPermission(), PERMISSION_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshPermission]);
}
