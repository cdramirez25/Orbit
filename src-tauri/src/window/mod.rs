//! Ventana de la isla: creación, posicionamiento y detección del notch.

pub mod island_window;
pub mod notch;
mod platform;

/// Preparación de la app específica del SO (macOS: política de activación y plugin de paneles).
pub fn prepare_app(app: &mut tauri::App) -> tauri::Result<()> {
    platform::current::prepare_app(app)
}
