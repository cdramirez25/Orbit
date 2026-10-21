use std::sync::Arc;

use tauri::State;

use super::CommandError;
use crate::ai::providers::ProviderId;
use crate::ai::{AiError, AiStatus, SaveInput};
use crate::app_state::AppState;

/// Qué proveedor está activo y qué tiene guardado cada uno (nunca las claves, solo si hay una).
#[tauri::command]
pub async fn ai_get_status(state: State<'_, AppState>) -> Result<AiStatus, CommandError> {
    let ai = Arc::clone(&state.ai);
    let status = tauri::async_runtime::spawn_blocking(move || ai.status())
        .await
        .map_err(|error| AiError::Keychain(error.to_string()))?;
    Ok(status)
}

/// Guarda la clave (en el llavero del sistema), el modelo y la dirección de un proveedor.
#[tauri::command]
pub async fn ai_save_provider(
    state: State<'_, AppState>,
    id: ProviderId,
    input: SaveInput,
) -> Result<AiStatus, CommandError> {
    let ai = Arc::clone(&state.ai);
    let status = tauri::async_runtime::spawn_blocking(move || ai.save(id, input))
        .await
        .map_err(|error| AiError::Keychain(error.to_string()))??;
    Ok(status)
}

/// Elige con qué proveedor responde Orbit (`null`: ninguno).
#[tauri::command]
pub async fn ai_set_active(
    state: State<'_, AppState>,
    id: Option<ProviderId>,
) -> Result<AiStatus, CommandError> {
    let ai = Arc::clone(&state.ai);
    let status = tauri::async_runtime::spawn_blocking(move || ai.set_active(id))
        .await
        .map_err(|error| AiError::Keychain(error.to_string()))?;
    Ok(status)
}

/// Prueba de verdad un proveedor con una petición mínima y devuelve lo que contestó.
#[tauri::command]
pub async fn ai_test_provider(
    state: State<'_, AppState>,
    id: ProviderId,
) -> Result<String, CommandError> {
    let ai = Arc::clone(&state.ai);
    let reply = tauri::async_runtime::spawn_blocking(move || ai.test(id))
        .await
        .map_err(|error| AiError::Network(error.to_string()))??;
    Ok(reply)
}

/// Los modelos que ofrece un proveedor con la clave guardada (para elegir uno en la lista).
#[tauri::command]
pub async fn ai_list_models(
    state: State<'_, AppState>,
    id: ProviderId,
) -> Result<Vec<String>, CommandError> {
    let ai = Arc::clone(&state.ai);
    let models = tauri::async_runtime::spawn_blocking(move || ai.models(id))
        .await
        .map_err(|error| AiError::Network(error.to_string()))??;
    Ok(models)
}
