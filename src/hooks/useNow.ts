import { useEffect, useState } from 'react';

/** Hora actual en milisegundos, refrescada cada `intervalMs` (para textos tipo "hace 5 min"). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
