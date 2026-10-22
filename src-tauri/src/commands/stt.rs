use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::CommandError;
use crate::app_state::AppState;
use crate::settings::Settings;
use crate::stt::catalog::SttModel;
use crate::stt::model::{ModelError, ModelStatus};
use crate::stt::SttLanguage;

/// Estado de los modelos de transcripción: cuál se usa, cuáles están, cuánto se lleva descargado
/// y el último fallo de cada uno.
#[tauri::command]
pub fn stt_model_status(state: State<'_, AppState>) -> ModelStatus {
    state.models.status()
}

/// Deja un modelo (ya descargado) como el que usa el motor y lo guarda en los ajustes. La
/// siguiente frase que se transcriba lo carga.
fn use_model(app: &AppHandle, model: SttModel) -> Result<ModelStatus, ModelError> {
    let state = app.state::<AppState>();
    state.models.set_active(model)?;
    state.update_settings(|settings| settings.stt_model = model);
    Ok(state.models.status())
}

/// Empieza a descargar un modelo en segundo plano; el progreso llega por el evento `stt:model`.
/// Al terminar bien, ese modelo pasa a ser el que se usa: se baja para usarlo.
#[tauri::command]
pub fn stt_model_download(
    app: AppHandle,
    state: State<'_, AppState>,
    model: SttModel,
) -> Result<(), CommandError> {
    state.models.download(model, move || {
        if let Err(error) = use_model(&app, model) {
            tracing::warn!(%error, ?model, "no se pudo activar el modelo recién descargado");
        }
    })?;
    Ok(())
}

/// Cancela la descarga en curso.
#[tauri::command]
pub fn stt_model_cancel(state: State<'_, AppState>) {
    state.models.cancel();
}

/// Borra un modelo del disco (se puede volver a descargar).
#[tauri::command]
pub fn stt_model_remove(state: State<'_, AppState>, model: SttModel) -> Result<(), CommandError> {
    state.models.remove(model)?;
    Ok(())
}

/// Elige cuál de los modelos descargados se usa.
#[tauri::command]
pub fn stt_model_use(app: AppHandle, model: SttModel) -> Result<ModelStatus, CommandError> {
    Ok(use_model(&app, model)?)
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
