//! Ventanas de Orbit: la isla (creación, posicionamiento y notch) y la de ajustes.

pub mod island_window;
pub mod notch;
mod platform;
pub mod settings_window;

/// Preparación de la app específica del SO (macOS: política de activación y plugin de paneles).
pub fn prepare_app(app: &mut tauri::App) -> tauri::Result<()> {
    platform::current::prepare_app(app)
}

/// Dónde está el puntero respecto a la esquina superior izquierda de la ventana de la isla, en
/// puntos lógicos. Cada SO lo mide a su manera (ver `platform/`).
pub fn pointer_in_island(app: &tauri::AppHandle) -> tauri::Result<(f64, f64)> {
    platform::current::pointer_in_island(app)
}

/// Puntero global en píxeles físicos → puntos lógicos dentro de una ventana que empieza en `origin`
/// (también en píxeles físicos) y tiene esa escala.
#[cfg(any(target_os = "windows", test))]
pub fn pointer_from_physical(cursor: (f64, f64), origin: (i32, i32), scale: f64) -> (f64, f64) {
    (
        (cursor.0 - f64::from(origin.0)) / scale,
        (cursor.1 - f64::from(origin.1)) / scale,
    )
}

/// Deja que la isla reciba el teclado mientras el usuario escribe una pregunta, y se lo devuelve
/// después a la app de antes.
pub fn set_island_keyboard(app: &tauri::AppHandle, enabled: bool) -> tauri::Result<()> {
    platform::current::set_island_keyboard(app, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_global_physical_cursor_to_window_logical() {
        // Ventana en (1000, 0) con escala 2; cursor a 200 px físicos dentro y 80 px abajo.
        assert_eq!(
            pointer_from_physical((1200.0, 80.0), (1000, 0), 2.0),
            (100.0, 40.0)
        );
    }

    #[test]
    fn cursor_outside_the_window_is_negative() {
        assert_eq!(
            pointer_from_physical((900.0, 10.0), (1000, 0), 1.0).0,
            -100.0
        );
    }
}
