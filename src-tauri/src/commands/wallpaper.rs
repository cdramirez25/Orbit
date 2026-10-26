use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use super::CommandError;
use crate::app_state::AppState;
use crate::wallpaper::{
    self, platform, PerformanceMode, WallpaperError, WallpaperItem, WallpaperService,
    WallpaperStatus,
};

/// Corre algo del servicio fuera del hilo principal: crear o mover las ventanas del escritorio le
/// pide cosas a ese hilo y espera.
async fn off_main<T: Send + 'static>(
    state: &State<'_, AppState>,
    work: impl FnOnce(&WallpaperService) -> T + Send + 'static,
) -> Result<T, CommandError> {
    let service = Arc::clone(&state.wallpaper);
    tauri::async_runtime::spawn_blocking(move || work(&service))
        .await
        .map_err(|error| WallpaperError::Surface(error.to_string()).into())
}

/// Guarda en los ajustes lo que quedó elegido, para retomarlo al abrir Orbit.
fn persist(state: &State<'_, AppState>) {
    let settings = state.wallpaper.settings();
    state.update_settings(|all| all.wallpaper = settings);
}

/// Le pide al video de una ventana de fondo que se reproduzca. macOS no deja empezar un video
/// solo (ni sin sonido) dentro del webview, pero sí cuando el script lo lanza la propia app con
/// `eval`: WebKit lo trata como una acción del usuario. Solo vale para las ventanas de fondo.
#[tauri::command]
pub fn wallpaper_play(window: WebviewWindow) -> Result<(), CommandError> {
    if window.label().starts_with(wallpaper::surface::LABEL_PREFIX) {
        window
            .eval("(() => { const video = document.querySelector('video'); if (video) void video.play().catch(() => {}); })()")
            .map_err(|error| WallpaperError::Surface(error.to_string()))?;
    }
    Ok(())
}

/// Cómo está el fondo: qué archivo, si se muestra, si está en pausa y la carpeta de los fondos.
#[tauri::command]
pub fn wallpaper_status(state: State<'_, AppState>) -> WallpaperStatus {
    state.wallpaper.status()
}

/// Los archivos que hay ahora en la carpeta de fondos.
#[tauri::command]
pub async fn wallpaper_list(
    state: State<'_, AppState>,
) -> Result<Vec<WallpaperItem>, CommandError> {
    off_main(&state, |service| service.items()).await
}

/// Elige un archivo de la carpeta como fondo y lo muestra.
#[tauri::command]
pub async fn wallpaper_select(
    state: State<'_, AppState>,
    file: String,
) -> Result<WallpaperStatus, CommandError> {
    let status = off_main(&state, move |service| service.select(&file)).await??;
    persist(&state);
    Ok(status)
}

/// Muestra u oculta el fondo (el archivo elegido se recuerda).
#[tauri::command]
pub async fn wallpaper_set_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<WallpaperStatus, CommandError> {
    let status = off_main(&state, move |service| {
        service.update(|settings| settings.enabled = enabled)
    })
    .await?;
    persist(&state);
    Ok(status)
}

/// Pausa o reanuda el fondo a mano.
#[tauri::command]
pub async fn wallpaper_set_paused(
    state: State<'_, AppState>,
    paused: bool,
) -> Result<WallpaperStatus, CommandError> {
    let status = off_main(&state, move |service| {
        service.update(|settings| settings.paused = paused)
    })
    .await?;
    persist(&state);
    Ok(status)
}

/// Elige cuándo se pausa solo para ahorrar recursos.
#[tauri::command]
pub async fn wallpaper_set_performance(
    state: State<'_, AppState>,
    mode: PerformanceMode,
) -> Result<WallpaperStatus, CommandError> {
    let status = off_main(&state, move |service| {
        service.update(|settings| settings.performance = mode)
    })
    .await?;
    persist(&state);
    Ok(status)
}

/// Abre la carpeta de fondos en el explorador de archivos.
#[tauri::command]
pub fn wallpaper_open_folder(state: State<'_, AppState>) -> Result<(), CommandError> {
    platform::open_folder(state.wallpaper.folder())?;
    Ok(())
}

/// Abre el selector de archivos del sistema (con ese título, ya traducido) y copia lo que se elija a
/// la carpeta de fondos. Devuelve cómo quedó la lista.
#[tauri::command]
pub async fn wallpaper_add_files(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
) -> Result<Vec<WallpaperItem>, CommandError> {
    let picker = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        picker
            .dialog()
            .file()
            .set_title(&title)
            .add_filter(&title, &wallpaper::accepted_extensions())
            .blocking_pick_files()
    })
    .await
    .map_err(|error| WallpaperError::Copy(error.to_string()))?;

    let sources: Vec<PathBuf> = picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .collect();
    off_main(&state, move |service| {
        for source in &sources {
            if let Err(error) = wallpaper::copy_into(service.folder(), source) {
                tracing::warn!(code = error.code(), "no se pudo copiar un fondo");
            }
        }
        service.items()
    })
    .await
}
