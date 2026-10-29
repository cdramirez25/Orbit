use std::sync::Arc;

use tauri::State;

use super::CommandError;
use crate::app_state::AppState;
use crate::system_stats::{SystemStats, SystemStatsError};

/// El estado del equipo ahora: CPU, memoria, red y, en un portátil, la batería. La CPU y las
/// velocidades son lo ocurrido desde la última vez que se pidió.
#[tauri::command]
pub async fn get_system_stats(state: State<'_, AppState>) -> Result<SystemStats, CommandError> {
    let service = Arc::clone(&state.system_stats);
    // Leer el sistema es rápido pero bloqueante: se hace fuera del hilo del runtime.
    let stats = tauri::async_runtime::spawn_blocking(move || service.snapshot())
        .await
        .map_err(|error| SystemStatsError::Read(error.to_string()))?;
    Ok(stats)
}
