use std::sync::Arc;

use tauri::State;

use super::CommandError;
use crate::app_state::AppState;
use crate::weather::{WeatherError, WeatherReport};

/// Clima de la zona del usuario. Con `force` se salta la caché de 10 minutos.
#[tauri::command]
pub async fn get_weather(
    state: State<'_, AppState>,
    force: bool,
) -> Result<WeatherReport, CommandError> {
    let service = Arc::clone(&state.weather);
    // La petición a Internet es bloqueante: se hace fuera del hilo del runtime.
    let result = tauri::async_runtime::spawn_blocking(move || service.get(force))
        .await
        .map_err(|error| WeatherError::Network(error.to_string()))?;
    Ok(result?)
}
