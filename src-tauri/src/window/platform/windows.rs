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

/// La isla nunca recibe el foco (`WS_EX_NOACTIVATE`), salvo mientras el usuario escribe una pregunta.
pub fn set_island_keyboard(app: &AppHandle, enabled: bool) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.set_focusable(enabled)?;
        if enabled {
            window.set_focus()?;
        }
    }
    Ok(())
}

/// Dónde está el puntero respecto a la esquina superior izquierda de la ventana de la isla, en
/// puntos lógicos. En Windows el puntero y la ventana vienen en píxeles físicos del mismo escritorio
/// virtual, así que basta restarlos y dividir por la escala de la ventana.
pub fn pointer_in_island(app: &AppHandle) -> tauri::Result<(f64, f64)> {
    let window = app
        .get_webview_window(LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;
    let cursor = window.cursor_position()?;
    let origin = window.outer_position()?;
    Ok(crate::window::pointer_from_physical(
        (cursor.x, cursor.y),
        (origin.x, origin.y),
        window.scale_factor()?,
    ))
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
