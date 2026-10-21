const BAR_DELAYS = [0, 0.15, 0.3, 0.1] as const;

/** Punto "escuchando" a la izquierda y mini ondas a la derecha (el centro queda libre para el notch). */
export function Compact() {
  return (
    <div className="flex h-full items-center justify-between px-5">
      <span className="orbit-pulse size-2.5 rounded-full bg-accent" />
      <div className="flex h-3.5 items-center gap-[3px]" aria-hidden>
        {BAR_DELAYS.map((delay) => (
          <span
            key={delay}
            className="orbit-wave h-full w-[3px] origin-center rounded-full bg-accent"
            style={{ animation: `orbit-wave 0.9s ease-in-out ${delay}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}
