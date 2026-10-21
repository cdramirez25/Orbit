use std::sync::Arc;

use tauri::State;

use super::CommandError;
use crate::app_state::AppState;
use crate::clipboard::history::EntryView;
use crate::clipboard::ClipboardError;

/// Historial del portapapeles de esta sesión, lo más reciente primero.
#[tauri::command]
pub async fn get_clipboard_history(
    state: State<'_, AppState>,
) -> Result<Vec<EntryView>, CommandError> {
    Ok(state.clipboard.list())
}

/// Vuelve a poner un elemento del historial en el portapapeles. Los comandos `async` corren
/// fuera del hilo principal: decodificar una imagen grande puede tardar.
#[tauri::command]
pub async fn copy_clipboard_entry(state: State<'_, AppState>, id: u64) -> Result<(), CommandError> {
    let service = Arc::clone(&state.clipboard);
    tauri::async_runtime::spawn_blocking(move || service.copy(id))
        .await
        .map_err(|error| ClipboardError::System(error.to_string()))??;
    Ok(())
}

#[tauri::command]
pub async fn delete_clipboard_entry(
    state: State<'_, AppState>,
    id: u64,
) -> Result<(), CommandError> {
    state.clipboard.delete(id);
    Ok(())
}

#[tauri::command]
pub async fn clear_clipboard_history(state: State<'_, AppState>) -> Result<(), CommandError> {
    state.clipboard.clear();
    Ok(())
}
