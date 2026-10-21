//! Ventanas de Orbit: la isla (creación, posicionamiento y notch) y la de ajustes.

pub mod island_window;
pub mod notch;
mod platform;
pub mod settings_window;

/// Preparación de la app específica del SO (macOS: política de activación y plugin de paneles).
pub fn prepare_app(app: &mut tauri::App) -> tauri::Result<()> {
    platform::current::prepare_app(app)
}

/// Deja que la isla reciba el teclado mientras el usuario escribe una pregunta, y se lo devuelve
/// después a la app de antes.
pub fn set_island_keyboard(app: &tauri::AppHandle, enabled: bool) -> tauri::Result<()> {
    platform::current::set_island_keyboard(app, enabled)
}
