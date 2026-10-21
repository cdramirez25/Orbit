/**
 * Código estable de un error de comando de Rust (llega como `{ code, message }`), o `null` si el
 * error no lo trae. Sirve para elegir el mensaje sin depender del texto.
 */
export function commandErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return null;
}
