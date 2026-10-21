/**
 * Estado del permiso para capturar el audio del sistema (espejo de `PermissionStatus` en
 * `src-tauri/src/audio/permission.rs`).
 * - `granted`: concedido.
 * - `denied`: ya se pidió y sigue sin concederse (hay que ir a Ajustes del Sistema).
 * - `notDetermined`: todavía no se ha pedido.
 * - `notRequired`: este sistema no exige permiso (Windows).
 */
export type PermissionStatus = 'granted' | 'denied' | 'notDetermined' | 'notRequired';
