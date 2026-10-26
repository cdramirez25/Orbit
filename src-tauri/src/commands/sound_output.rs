use std::sync::Arc;

use tauri::State;

use super::CommandError;
use crate::app_state::AppState;
use crate::sound_output::{OutputDevice, SoundOutputError, SoundOutputService};

/// Corre algo del servicio fuera del hilo principal: hablar con el sistema de audio puede tardar.
async fn off_main<T: Send + 'static>(
    state: &State<'_, AppState>,
    work: impl FnOnce(&SoundOutputService) -> Result<T, SoundOutputError> + Send + 'static,
) -> Result<T, CommandError> {
    let service = Arc::clone(&state.sound_output);
    tauri::async_runtime::spawn_blocking(move || work(&service))
        .await
        .map_err(|error| SoundOutputError::List(error.to_string()))?
        .map_err(Into::into)
}

/// Las salidas de sonido conectadas y cuál es la que usa el sistema.
#[tauri::command]
pub async fn sound_output_list(
    state: State<'_, AppState>,
) -> Result<Vec<OutputDevice>, CommandError> {
    off_main(&state, |service| service.list()).await
}

/// Cambia la salida de sonido del sistema y devuelve cómo quedó la lista.
#[tauri::command]
pub async fn sound_output_set(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<OutputDevice>, CommandError> {
    off_main(&state, move |service| service.choose(&id)).await
}
