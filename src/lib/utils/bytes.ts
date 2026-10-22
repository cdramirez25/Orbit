/** Tamaño legible en MB o GB (base 1000, como lo muestran los sitios de descarga): `488 MB`, `1.2 GB`. */
export function formatBytes(bytes: number): string {
  const mb = Math.max(0, bytes) / 1_000_000;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** Porcentaje entero (0 a 100) de `done` sobre `total`; 0 si no hay total. */
export function percentOf(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((done / total) * 100)));
}
