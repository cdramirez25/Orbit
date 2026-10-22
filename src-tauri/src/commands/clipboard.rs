use std::sync::Arc;

use tauri::State;

use super::CommandError;
use crate::ai::transform::{self, TextAction};
use crate::ai::AiError;
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

/// Un texto más largo que esto no se copia (lo que contesta la IA nunca llega a tanto).
const MAX_COPY_CHARS: usize = 100_000;

/// Pone un texto cualquiera en el portapapeles (el resultado de una acción de IA, por ejemplo).
#[tauri::command]
pub async fn copy_clipboard_text(
    state: State<'_, AppState>,
    text: String,
) -> Result<(), CommandError> {
    let text: String = text.chars().take(MAX_COPY_CHARS).collect();
    let service = Arc::clone(&state.clipboard);
    tauri::async_runtime::spawn_blocking(move || service.write_text(text))
        .await
        .map_err(|error| ClipboardError::System(error.to_string()))??;
    Ok(())
}

/// Le pide a la IA activa que traduzca, resuma o explique un texto del historial y devuelve el
/// resultado. El texto no sale de Rust hasta el proveedor y no se escribe en los logs. `language` es
/// el idioma de la interfaz.
#[tauri::command]
pub async fn clipboard_ai(
    state: State<'_, AppState>,
    id: u64,
    action: TextAction,
    language: String,
) -> Result<String, CommandError> {
    let text = state.clipboard.text_of(id)?;
    let ai = Arc::clone(&state.ai);
    let result =
        tauri::async_runtime::spawn_blocking(move || transform::run(&ai, action, &language, &text))
            .await
            .map_err(|error| AiError::Storage(error.to_string()))??;
    Ok(result)
}
