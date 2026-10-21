use std::sync::Arc;

use tauri::State;

use super::CommandError;
use crate::app_state::AppState;
use crate::media::{MediaCommand, MediaError, NowPlaying};

/// Lo que suena ahora (la interfaz lo pide al abrir y luego se entera por `media:changed`).
#[tauri::command]
pub async fn get_now_playing(
    state: State<'_, AppState>,
) -> Result<Option<NowPlaying>, CommandError> {
    Ok(state.media.current())
}

/// Envía play, pausa, anterior o siguiente al reproductor actual. Corre fuera del hilo principal:
/// el adaptador puede tardar en responder.
#[tauri::command]
pub async fn media_command(
    state: State<'_, AppState>,
    command: MediaCommand,
) -> Result<(), CommandError> {
    let service = Arc::clone(&state.media);
    tauri::async_runtime::spawn_blocking(move || service.send(command))
        .await
        .map_err(|error| MediaError::Command(error.to_string()))??;
    Ok(())
}
