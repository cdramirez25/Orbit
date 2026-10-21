use std::sync::{MutexGuard, PoisonError};

use tauri::State;

use super::CommandError;
use crate::app_state::AppState;
use crate::pipeline::Pipeline;

fn pipeline(state: &AppState) -> MutexGuard<'_, Pipeline> {
    state
        .pipeline
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

/// Empieza a escuchar el audio del sistema. Los comandos `async` corren fuera del hilo
/// principal, que es lo que se quiere porque arrancar la captura puede tardar.
#[tauri::command]
pub async fn start_listening(state: State<'_, AppState>) -> Result<(), CommandError> {
    pipeline(&state).start()?;
    Ok(())
}

#[tauri::command]
pub async fn stop_listening(state: State<'_, AppState>) -> Result<(), CommandError> {
    pipeline(&state).stop();
    Ok(())
}

#[tauri::command]
pub fn is_listening(state: State<'_, AppState>) -> bool {
    pipeline(&state).is_listening()
}
