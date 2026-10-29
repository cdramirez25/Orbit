import { useEffect } from 'react';

import { useSystemStore } from '@/stores/system.store';

/** Mantiene al día el estado del equipo mientras el componente está a la vista. */
export function useSystemPolling(): void {
  const start = useSystemStore((s) => s.start);
  const stop = useSystemStore((s) => s.stop);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);
}
