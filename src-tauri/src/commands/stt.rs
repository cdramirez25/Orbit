use tauri::State;

use super::CommandError;
use crate::app_state::AppState;
use crate::settings::Settings;
use crate::stt::model::ModelStatus;
use crate::stt::SttLanguage;

/// Estado del modelo de transcripción: si está, cuánto se lleva descargado y el último fallo.
#[tauri::command]
pub fn stt_model_status(state: State<'_, AppState>) -> ModelStatus {
    state.models.status()
}

/// Empieza a descargar el modelo en segundo plano; el progreso llega por el evento `stt:model`.
#[tauri::command]
pub fn stt_model_download(state: State<'_, AppState>) -> Result<(), CommandError> {
    state.models.download()?;
    Ok(())
}

/// Cancela la descarga en curso.
#[tauri::command]
pub fn stt_model_cancel(state: State<'_, AppState>) {
    state.models.cancel();
}

/// Borra el modelo del disco (se puede volver a descargar).
#[tauri::command]
pub fn stt_model_remove(state: State<'_, AppState>) -> Result<(), CommandError> {
    state.models.remove()?;
    Ok(())
}

/// Cambia el idioma de la transcripción, lo guarda y lo aplica desde la siguiente frase.
#[tauri::command]
pub fn set_stt_language(state: State<'_, AppState>, language: SttLanguage) -> Settings {
    state.stt.set_language(language);
    state.update_settings(|settings| settings.stt_language = language)
}
