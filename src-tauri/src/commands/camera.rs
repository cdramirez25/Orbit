use std::sync::Arc;

use chrono::Local;
use tauri::{AppHandle, Manager, State};

use super::CommandError;
use crate::app_state::AppState;
use crate::camera::{self, platform, CameraError};
use crate::clipboard::ClipboardError;

/// Pone la foto (PNG en base64) en el portapapeles como una imagen más del historial.
#[tauri::command]
pub async fn copy_camera_photo(
    state: State<'_, AppState>,
    png_base64: String,
) -> Result<(), CommandError> {
    let png = camera::decode_photo(&png_base64)?;
    let clipboard = Arc::clone(&state.clipboard);
    tauri::async_runtime::spawn_blocking(move || clipboard.write_png(&png))
        .await
        .map_err(|error| ClipboardError::System(error.to_string()))??;
    Ok(())
}

/// Guarda la foto (PNG en base64) en `Imágenes/Orbit` y devuelve el nombre del archivo.
#[tauri::command]
pub async fn save_camera_photo(app: AppHandle, png_base64: String) -> Result<String, CommandError> {
    let png = camera::decode_photo(&png_base64)?;
    let dir = app
        .path()
        .picture_dir()
        .map_err(|error| CameraError::Save(error.to_string()))?
        .join("Orbit");
    let stamp = Local::now().format("%Y-%m-%d-%H-%M-%S").to_string();
    let path = tauri::async_runtime::spawn_blocking(move || camera::save_photo(&dir, &png, &stamp))
        .await
        .map_err(|error| CameraError::Save(error.to_string()))??;
    Ok(path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default())
}

/// Abre la pantalla de privacidad del sistema donde se concede el permiso de la cámara.
#[tauri::command]
pub fn open_camera_settings() -> Result<(), CommandError> {
    platform::open_privacy_settings()?;
    Ok(())
}
