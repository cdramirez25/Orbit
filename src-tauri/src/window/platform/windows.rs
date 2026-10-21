//! Windows: ventana siempre encima, sin foco (`focusable(false)` → `WS_EX_NOACTIVATE`), fuera
//! de la barra de tareas (`skip_taskbar` → `WS_EX_TOOLWINDOW`) y sin sombra. Verificar a mano.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::window::island_window::{overlay_options, LABEL};
use crate::window::notch::{NotchInfo, ScreenFrame};

pub fn prepare_app(_app: &mut tauri::App) -> tauri::Result<()> {
    Ok(())
}

pub fn create_island(app: &AppHandle) -> tauri::Result<()> {
    overlay_options(WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("island.html".into()),
    ))
    .focusable(false)
    .build()?;
    Ok(())
}

pub fn show_island(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.show()?;
    }
    Ok(())
}

/// Windows no tiene notch.
pub fn notch_info(_app: &AppHandle) -> NotchInfo {
    NotchInfo::none(ScreenFrame {
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 0.0,
    })
}
