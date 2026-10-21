use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use super::CommandError;
use crate::app_state::AppState;
use crate::settings::{IslandAnchor, Point, Settings};
use crate::window::notch::{self, NotchInfo};
use crate::window::{island_window, settings_window};

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PointerPosition {
    pub x: f64,
    pub y: f64,
}

/// Puntero en px lógicos respecto a la esquina superior izquierda de la ventana.
fn to_window_logical(cursor: (f64, f64), origin: (i32, i32), scale: f64) -> PointerPosition {
    PointerPosition {
        x: (cursor.0 - f64::from(origin.0)) / scale,
        y: (cursor.1 - f64::from(origin.1)) / scale,
    }
}

#[tauri::command]
pub fn get_notch_info(app: AppHandle) -> NotchInfo {
    notch::detect(&app)
}

/// `true` = la ventana captura el mouse; `false` = click-through.
#[tauri::command]
pub fn set_island_interactive(
    window: WebviewWindow,
    interactive: bool,
) -> Result<(), CommandError> {
    window.set_ignore_cursor_events(!interactive)?;
    Ok(())
}

/// Con la ventana en click-through el webview no recibe `mousemove`, así que el frontend
/// consulta aquí la posición global del puntero (`useHitTest`).
#[tauri::command]
pub fn get_pointer_position(window: WebviewWindow) -> Result<PointerPosition, CommandError> {
    let cursor = window.cursor_position()?;
    let origin = window.outer_position()?;
    let scale = window.scale_factor()?;
    Ok(to_window_logical(
        (cursor.x, cursor.y),
        (origin.x, origin.y),
        scale,
    ))
}

/// Oculta (o muestra) las ventanas de Orbit en screen share. Lo puede pedir cualquier ventana
/// (la de ajustes también), así que se aplica a la isla por su nombre y no a quien llama.
#[tauri::command]
pub fn set_content_protected(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), CommandError> {
    let island = app
        .get_webview_window(island_window::LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;
    island.set_content_protected(enabled)?;
    settings_window::set_content_protected(&app, enabled)?;
    state.update_settings(|s| s.hide_from_screen_share = enabled);
    Ok(())
}

#[tauri::command]
pub fn get_island_settings(state: State<'_, AppState>) -> Settings {
    state.settings()
}

/// Cambia el ancla (izquierda / centro / derecha / libre), la aplica y la guarda.
#[tauri::command]
pub fn set_island_anchor(
    app: AppHandle,
    state: State<'_, AppState>,
    anchor: IslandAnchor,
) -> Result<Settings, CommandError> {
    // Al entrar en modo libre por primera vez, la isla se queda donde está.
    let current = island_window::current_origin(&app)?;
    let settings = state.update_settings(|s| {
        s.island_anchor = anchor;
        if anchor == IslandAnchor::Free && s.free_origin.is_none() {
            s.free_origin = Some(current);
        }
    });
    island_window::place(&app, &settings)?;
    Ok(settings)
}

/// Esquina superior izquierda de la ventana (puntos lógicos globales): punto de partida del arrastre.
#[tauri::command]
pub fn get_island_origin(app: AppHandle) -> Result<Point, CommandError> {
    Ok(island_window::current_origin(&app)?)
}

/// Mueve la ventana durante el arrastre; con `commit` (al soltar) la posición se guarda y el
/// ancla pasa a ser `libre`.
#[tauri::command]
pub fn set_island_origin(
    app: AppHandle,
    state: State<'_, AppState>,
    x: f64,
    y: f64,
    commit: bool,
) -> Result<(), CommandError> {
    let origin = island_window::move_to(&app, Point { x, y })?;
    if commit {
        state.update_settings(|s| {
            s.island_anchor = IslandAnchor::Free;
            s.free_origin = Some(origin);
        });
    }
    Ok(())
}

/// Salida temporal para desarrollo (la bandeja con "Salir" llega en la Fase 5).
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_global_physical_cursor_to_window_logical() {
        // Ventana en (1000, 0) con escala 2; cursor a 200 px físicos dentro y 80 px abajo.
        let p = to_window_logical((1200.0, 80.0), (1000, 0), 2.0);
        assert_eq!(p, PointerPosition { x: 100.0, y: 40.0 });
    }

    #[test]
    fn cursor_outside_the_window_is_negative() {
        let p = to_window_logical((900.0, 10.0), (1000, 0), 1.0);
        assert_eq!(p.x, -100.0);
    }
}
