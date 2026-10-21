import { useEffect, type RefObject } from 'react';

/** Avisa de la altura (border-box) del elemento cada vez que cambia, sin re-renderizar por frame. */
export function useElementHeight(
  ref: RefObject<HTMLElement | null>,
  onChange: (height: number) => void,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize[0];
      onChange(box ? box.blockSize : element.offsetHeight);
    });
    observer.observe(element);
    onChange(element.offsetHeight);
    return () => observer.disconnect();
  }, [ref, onChange]);
}
