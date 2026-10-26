//! Código específico de cada sistema operativo del fondo de pantalla. Solo aquí (y bajo
//! `#[cfg(target_os = "...")]`): crear las ventanas detrás de los iconos y ver qué ventanas hay
//! abiertas. La lógica común entra siempre por `platform::current`.
//!
//! Las medidas de los monitores y de las ventanas van en las unidades de cada sistema (puntos
//! lógicos en macOS, píxeles físicos en Windows), pero siempre las mismas entre sí.

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
pub use self::macos as current;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub use self::windows as current;

use std::sync::mpsc;
use std::time::Duration;

use tauri::webview::{PermissionResponse, WebviewWindowBuilder};
use tauri::{AppHandle, WebviewUrl, WebviewWindow};

use super::{cover_of, ScreenCover, WallpaperError, WindowWatcher};
use crate::window::island_window::Rect;

/// Cuánto se espera a que el hilo principal haga algo que se le pidió.
const MAIN_THREAD_TIMEOUT: Duration = Duration::from_secs(5);

/// Un monitor: su nombre técnico (si el sistema lo da), el nombre para mostrarlo (si lo hay) y dónde
/// está, en las unidades del sistema.
#[derive(Debug, Clone, PartialEq)]
pub struct ScreenFrame {
    pub name: Option<String>,
    pub label: Option<String>,
    pub rect: Rect,
}

/// Los monitores, en las unidades del sistema.
pub fn screens(app: &AppHandle) -> Result<Vec<ScreenFrame>, WallpaperError> {
    current::screens(app).map_err(|error| WallpaperError::Surface(error.to_string()))
}

/// Crea (sin mostrarla todavía) una ventana de fondo: sin bordes, sin foco, fuera de la barra de
/// tareas y que no recibe el mouse. Carga `wallpaper.html`. Nunca puede pedir permisos al sistema.
pub fn create_window(app: &AppHandle, label: &str) -> Result<WebviewWindow, WallpaperError> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("wallpaper.html".into()))
        .title("Orbit wallpaper")
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .on_permission_request(|_, _| PermissionResponse::Deny);
    let window = current::customize(builder)
        .build()
        .map_err(|error| WallpaperError::Surface(error.to_string()))?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| WallpaperError::Surface(error.to_string()))?;
    Ok(window)
}

/// Pone la ventana sobre un monitor, detrás de los iconos del escritorio, y la muestra.
pub fn place(app: &AppHandle, window: &WebviewWindow, frame: Rect) -> Result<(), WallpaperError> {
    current::place(app, window, frame)
}

/// Abre la carpeta en el explorador de archivos del sistema.
pub fn open_folder(path: &std::path::Path) -> Result<(), WallpaperError> {
    current::open_folder(path)
}

/// Hace algo en el hilo principal y espera a que termine. No debe llamarse desde el propio hilo
/// principal (se esperaría a sí mismo): el servicio del fondo siempre corre en otros hilos.
fn on_main_thread(
    app: &AppHandle,
    work: impl FnOnce() + Send + 'static,
) -> Result<(), WallpaperError> {
    let (done, wait) = mpsc::channel();
    app.run_on_main_thread(move || {
        work();
        let _ = done.send(());
    })
    .map_err(|error| WallpaperError::Surface(error.to_string()))?;
    wait.recv_timeout(MAIN_THREAD_TIMEOUT)
        .map_err(|_| WallpaperError::Surface("el hilo principal no respondió".into()))
}

/// Adaptador: mira las ventanas abiertas del sistema.
pub struct SystemWindowWatcher {
    app: AppHandle,
}

impl SystemWindowWatcher {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl WindowWatcher for SystemWindowWatcher {
    fn covers(&self) -> Result<Vec<ScreenCover>, WallpaperError> {
        let screens = screens(&self.app)?;
        let windows = current::open_windows(&self.app)?;
        Ok(screens
            .iter()
            .map(|screen| cover_of(screen.rect, &windows))
            .collect())
    }
}
