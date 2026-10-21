//! Ventanas de Orbit: la isla (creación, posicionamiento y notch) y la de ajustes.

pub mod island_window;
pub mod notch;
mod platform;
pub mod settings_window;

/// Preparación de la app específica del SO (macOS: política de activación y plugin de paneles).
pub fn prepare_app(app: &mut tauri::App) -> tauri::Result<()> {
    platform::current::prepare_app(app)
}
