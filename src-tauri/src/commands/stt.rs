use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::CommandError;
use crate::app_state::AppState;
use crate::settings::Settings;
use crate::stt::model::{ModelError, ModelStatus};
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

/// Cambia la carpeta del modelo, la guarda en los ajustes y devuelve cómo quedó. Mueve el archivo
/// (son cientos de MB) fuera del hilo principal.
async fn apply_model_dir(
    app: AppHandle,
    dir: Option<PathBuf>,
) -> Result<ModelStatus, CommandError> {
    let status = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.models.set_dir(dir.clone())?;
        state.update_settings(|settings| settings.model_dir = dir);
        Ok::<_, ModelError>(state.models.status())
    })
    .await
    .map_err(|error| ModelError::Disk(error.to_string()))??;
    Ok(status)
}

/// Abre el selector de carpetas del sistema (con el título que manda la interfaz, ya traducido) y,
/// si el usuario elige una, pasa el modelo allí. `None` si cancela.
#[tauri::command]
pub async fn stt_model_choose_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
) -> Result<Option<ModelStatus>, CommandError> {
    let start = state.models.status().dir;
    let picker = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        picker
            .dialog()
            .file()
            .set_title(title)
            .set_directory(start)
            .blocking_pick_folder()
    })
    .await
    .map_err(|error| ModelError::Disk(error.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let dir = picked
        .into_path()
        .map_err(|error| ModelError::Disk(error.to_string()))?;
    apply_model_dir(app, Some(dir)).await.map(Some)
}

/// Devuelve el modelo a la carpeta de la app.
#[tauri::command]
pub async fn stt_model_reset_dir(app: AppHandle) -> Result<ModelStatus, CommandError> {
    apply_model_dir(app, None).await
}
