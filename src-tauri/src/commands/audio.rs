use tauri::State;

use super::CommandError;
use crate::app_state::AppState;
use crate::audio::permission::{status_of, PermissionStatus};

/// Estado actual del permiso para capturar el audio del sistema.
#[tauri::command]
pub fn get_audio_permission(state: State<'_, AppState>) -> PermissionStatus {
    status_of(
        state.audio_permission.as_ref(),
        state.settings().screen_capture_prompted,
    )
}

/// Le pide el permiso al sistema (su aviso sale solo la primera vez) y recuerda que ya se pidió.
#[tauri::command]
pub fn request_audio_permission(state: State<'_, AppState>) -> PermissionStatus {
    state.audio_permission.request();
    let settings = state.update_settings(|s| s.screen_capture_prompted = true);
    status_of(
        state.audio_permission.as_ref(),
        settings.screen_capture_prompted,
    )
}

/// Abre la pantalla de Ajustes del Sistema donde se concede el permiso.
#[tauri::command]
pub fn open_audio_permission_settings(state: State<'_, AppState>) -> Result<(), CommandError> {
    state.audio_permission.open_system_settings()?;
    Ok(())
}
