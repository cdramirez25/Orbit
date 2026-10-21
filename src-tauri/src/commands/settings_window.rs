use tauri::{AppHandle, State};

use super::CommandError;
use crate::app_state::AppState;
use crate::window::settings_window;

/// Abre la ventana de ajustes (o la trae al frente si ya está abierta).
#[tauri::command]
pub fn open_settings_window(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    settings_window::open(&app, state.settings().hide_from_screen_share)?;
    Ok(())
}
