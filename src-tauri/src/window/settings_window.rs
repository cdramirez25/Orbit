//! Ventana de ajustes (por ahora solo en desarrollo): una ventana nativa normal, con barra de
//! título y esquinas para redimensionarla, que se mueve libremente por toda la pantalla. Cerrarla
//! solo la oculta, así que volver a abrirla es instantáneo y conserva su estado.

use tauri::window::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "settings";

/// Tamaño lógico inicial del contenido: la barra lateral (160 px) y la página.
const WIDTH: f64 = 760.0;
const HEIGHT: f64 = 460.0;
/// Por debajo de esto la página no cabe junto a la barra lateral.
const MIN_WIDTH: f64 = 600.0;
const MIN_HEIGHT: f64 = 360.0;
/// Fondo mientras carga la página (el mismo gris oscuro del panel), para no parpadear en blanco.
const BACKGROUND: Color = Color(23, 23, 23, 255);

/// Abre la ventana (la crea la primera vez) y la trae al frente. `protected` aplica lo de ocultar
/// de screen share también aquí.
pub fn open(app: &AppHandle, protected: bool) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("settings.html".into()))
        .title("Orbit")
        .inner_size(WIDTH, HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .background_color(BACKGROUND)
        .always_on_top(true)
        .center()
        .build()?;
    window.set_content_protected(protected)?;

    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = hidden.hide() {
                tracing::warn!(%error, "no se pudo ocultar la ventana de ajustes");
            }
        }
    });
    window.set_focus()?;
    Ok(())
}

/// Aplica "ocultar de screen share" a la ventana de ajustes si existe.
pub fn set_content_protected(app: &AppHandle, enabled: bool) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.set_content_protected(enabled)?;
    }
    Ok(())
}
