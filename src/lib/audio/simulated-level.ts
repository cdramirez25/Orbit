/**
 * Volumen inventado (0–1) que sube y baja como lo haría la música: varias ondas de distinta
 * velocidad sumadas. Mueve las ondas cuando no hay un volumen real (la música suena pero Orbit no
 * está capturando el audio, o en el navegador con `pnpm dev`).
 */
export function simulatedLevel(seconds: number): number {
  const wave =
    0.5 +
    0.3 * Math.sin(seconds * 5) +
    0.15 * Math.sin(seconds * 13.7) +
    0.1 * Math.sin(seconds * 29);
  return Math.min(1, Math.max(0, wave));
}
