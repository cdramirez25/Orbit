//! Crear, posicionar y mostrar la ventana de la isla (§3.3).
//!
//! La ventana es fija, transparente y de tamaño constante: la isla se anima dentro con DOM/CSS.
//! Nunca se anima el tamaño de la ventana nativa; para colocar la isla se mueve la ventana.
//!
//! Toda la geometría va en puntos lógicos con el origen arriba a la izquierda (el mismo espacio
//! en todos los monitores, aunque tengan escalas distintas).

use std::time::Duration;

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, LogicalPosition, Manager, Monitor, WebviewWindowBuilder, Wry};

use super::platform;
use crate::app_state::AppState;
use crate::settings::{IslandAnchor, Point, Settings};

pub const LABEL: &str = "island";

/// Tamaño lógico de la ventana. Debe coincidir con `WINDOW` en `src/lib/island/island.motion.ts`.
pub const WIDTH: f64 = 640.0;
pub const HEIGHT: f64 = 520.0;

/// Cuánto de la isla debe quedar siempre dentro del monitor al arrastrarla (puntos).
const REACH: f64 = 80.0;

/// Rectángulo de un monitor en puntos lógicos.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn contains(&self, p: Point) -> bool {
        p.x >= self.x && p.x < self.x + self.width && p.y >= self.y && p.y < self.y + self.height
    }
}

/// Opciones comunes de la ventana overlay (las de cada SO se añaden en `platform/`).
pub fn overlay_options<'a, M: Manager<Wry>>(
    builder: WebviewWindowBuilder<'a, Wry, M>,
) -> WebviewWindowBuilder<'a, Wry, M> {
    builder
        .title("Orbit")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        // La isla solo puede pedir la cámara (el módulo Cámara); cualquier otro permiso del webview
        // (micrófono, ubicación…) se niega. Sin esto el webview concede todo lo que se le pida.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Camera => PermissionResponse::Allow,
            _ => PermissionResponse::Deny,
        })
}

pub fn create(app: &AppHandle, settings: &Settings) -> tauri::Result<()> {
    platform::current::create_island(app)?;

    let window = app
        .get_webview_window(LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;

    // Oculta de screen share (macOS `sharingType`, Windows `WDA_EXCLUDEFROMCAPTURE`).
    window.set_content_protected(settings.hide_from_screen_share)?;
    // Click-through por defecto: solo se captura el mouse sobre la isla (set_island_interactive).
    window.set_ignore_cursor_events(true)?;

    place(app, settings)?;
    platform::current::show_island(app)
}

// ── Geometría pura (sin Tauri; se prueba con tests) ───────────────────────────────────────────

/// Esquina superior izquierda de la ventana para un ancla de preset en un monitor.
pub fn anchor_origin(anchor: IslandAnchor, monitor: Rect) -> Point {
    let x = match anchor {
        IslandAnchor::Left => monitor.x,
        IslandAnchor::Right => monitor.x + monitor.width - WIDTH,
        IslandAnchor::Center | IslandAnchor::Free => monitor.x + (monitor.width - WIDTH) / 2.0,
    };
    Point { x, y: monitor.y }
}

/// Mantiene la isla alcanzable: su centro dentro del monitor y la ventana sin salirse por abajo.
pub fn clamp_origin(origin: Point, monitor: Rect) -> Point {
    let min_x = monitor.x + REACH - WIDTH / 2.0;
    let max_x = monitor.x + monitor.width - REACH - WIDTH / 2.0;
    let max_y = monitor.y + monitor.height - REACH;
    Point {
        x: origin.x.max(min_x).min(max_x),
        y: origin.y.max(monitor.y).min(max_y),
    }
}

/// Monitor al que pertenece un punto del modo libre (si ya no existe, el principal).
fn monitor_for_free_origin(origin: Point, monitors: &[Rect], fallback: Rect) -> Rect {
    let island_center = Point {
        x: origin.x + WIDTH / 2.0,
        y: origin.y + 20.0,
    };
    monitors
        .iter()
        .find(|m| m.contains(island_center))
        .copied()
        .unwrap_or(fallback)
}

/// Dónde debe quedar la ventana según los ajustes y los monitores conectados.
pub fn resolve_origin(settings: &Settings, monitors: &[Rect], primary: usize) -> Option<Point> {
    let fallback = *monitors.get(primary).or(monitors.first())?;
    Some(match settings.island_anchor {
        IslandAnchor::Free => {
            let saved = settings
                .free_origin
                .unwrap_or_else(|| anchor_origin(IslandAnchor::Center, fallback));
            clamp_origin(saved, monitor_for_free_origin(saved, monitors, fallback))
        }
        anchor => anchor_origin(anchor, fallback),
    })
}

// ── Adaptadores con Tauri ─────────────────────────────────────────────────────────────────────

fn monitor_rect(monitor: &Monitor) -> Rect {
    let scale = monitor.scale_factor();
    let position = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);
    Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    }
}

/// Monitores conectados (en puntos lógicos) y el índice del principal.
fn monitors(app: &AppHandle) -> tauri::Result<(Vec<Rect>, usize)> {
    let rects: Vec<Rect> = app.available_monitors()?.iter().map(monitor_rect).collect();
    let primary = app
        .primary_monitor()?
        .map(|monitor| monitor_rect(&monitor))
        .and_then(|rect| rects.iter().position(|r| *r == rect))
        .unwrap_or(0);
    Ok((rects, primary))
}

fn set_origin(app: &AppHandle, origin: Point) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.set_position(LogicalPosition::new(origin.x, origin.y))?;
    }
    Ok(())
}

/// Coloca la ventana según los ajustes (ancla y, en modo libre, la posición guardada).
pub fn place(app: &AppHandle, settings: &Settings) -> tauri::Result<()> {
    let (rects, primary) = monitors(app)?;
    if let Some(origin) = resolve_origin(settings, &rects, primary) {
        set_origin(app, origin)?;
    }
    Ok(())
}

/// Esquina superior izquierda actual de la ventana, en puntos lógicos globales.
pub fn current_origin(app: &AppHandle) -> tauri::Result<Point> {
    let window = app
        .get_webview_window(LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;
    let position = window
        .outer_position()?
        .to_logical::<f64>(window.scale_factor()?);
    Ok(Point {
        x: position.x,
        y: position.y,
    })
}

/// Mueve la ventana (arrastre en modo libre). Devuelve el origen real tras limitarlo al monitor.
pub fn move_to(app: &AppHandle, requested: Point) -> tauri::Result<Point> {
    let (rects, primary) = monitors(app)?;
    let free = Settings {
        island_anchor: IslandAnchor::Free,
        free_origin: Some(requested),
        ..Settings::default()
    };
    let origin = resolve_origin(&free, &rects, primary).unwrap_or(requested);
    set_origin(app, origin)?;
    Ok(origin)
}

/// Recalcula la posición si cambia la resolución o la disposición de pantallas.
pub fn spawn_display_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<(Vec<Rect>, usize)> = None;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let Ok(current) = monitors(&app) else {
                continue;
            };
            if last.as_ref() != Some(&current) {
                if last.is_some() {
                    let settings = app.state::<AppState>().settings();
                    if let Err(error) = place(&app, &settings) {
                        tracing::warn!(%error, "no se pudo recolocar la isla");
                    }
                }
                last = Some(current);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pantalla integrada de un MacBook Air de 13" (1470×956 pt).
    const BUILT_IN: Rect = Rect {
        x: 0.0,
        y: 0.0,
        width: 1470.0,
        height: 956.0,
    };
    /// Monitor externo a la derecha, con su borde superior alineado al del portátil.
    const EXTERNAL: Rect = Rect {
        x: 1470.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    };

    fn settings(anchor: IslandAnchor, free_origin: Option<Point>) -> Settings {
        Settings {
            island_anchor: anchor,
            free_origin,
            ..Settings::default()
        }
    }

    #[test]
    fn presets_on_the_built_in_display() {
        assert_eq!(anchor_origin(IslandAnchor::Left, BUILT_IN).x, 0.0);
        assert_eq!(anchor_origin(IslandAnchor::Center, BUILT_IN).x, 415.0);
        assert_eq!(anchor_origin(IslandAnchor::Right, BUILT_IN).x, 830.0);
        assert_eq!(anchor_origin(IslandAnchor::Center, BUILT_IN).y, 0.0);
    }

    #[test]
    fn center_follows_the_monitor_size() {
        // En el monitor externo el centro es otro: se recalcula a partir del tamaño detectado.
        assert_eq!(
            anchor_origin(IslandAnchor::Center, EXTERNAL).x,
            1470.0 + 640.0
        );
        assert_eq!(
            anchor_origin(IslandAnchor::Right, EXTERNAL).x,
            1470.0 + 1920.0 - 640.0
        );
    }

    #[test]
    fn presets_always_use_the_primary_monitor() {
        let monitors = [BUILT_IN, EXTERNAL];
        let origin = resolve_origin(&settings(IslandAnchor::Right, None), &monitors, 0).unwrap();
        assert_eq!(origin, Point { x: 830.0, y: 0.0 });
    }

    #[test]
    fn free_mode_keeps_a_saved_position_on_any_monitor() {
        let monitors = [BUILT_IN, EXTERNAL];
        let saved = Point {
            x: 2000.0,
            y: 120.0,
        };
        let origin = resolve_origin(&settings(IslandAnchor::Free, Some(saved)), &monitors, 0);
        assert_eq!(origin, Some(saved));
    }

    #[test]
    fn free_mode_without_saved_position_starts_centered() {
        let origin = resolve_origin(&settings(IslandAnchor::Free, None), &[BUILT_IN], 0);
        assert_eq!(origin, Some(Point { x: 415.0, y: 0.0 }));
    }

    #[test]
    fn free_position_on_a_disconnected_monitor_falls_back_to_the_primary() {
        let gone = Point {
            x: 2000.0,
            y: 120.0,
        };
        let origin =
            resolve_origin(&settings(IslandAnchor::Free, Some(gone)), &[BUILT_IN], 0).unwrap();
        // Queda dentro del monitor principal, con la isla alcanzable.
        assert!(origin.x + WIDTH / 2.0 <= BUILT_IN.width - REACH);
    }

    #[test]
    fn clamp_keeps_the_island_reachable() {
        let far_right = clamp_origin(Point { x: 9000.0, y: 50.0 }, BUILT_IN);
        assert_eq!(far_right.x, BUILT_IN.width - REACH - WIDTH / 2.0);
        let far_left = clamp_origin(
            Point {
                x: -9000.0,
                y: 50.0,
            },
            BUILT_IN,
        );
        assert_eq!(far_left.x, REACH - WIDTH / 2.0);
        let too_high = clamp_origin(
            Point {
                x: 400.0,
                y: -300.0,
            },
            BUILT_IN,
        );
        assert_eq!(too_high.y, 0.0);
        let too_low = clamp_origin(
            Point {
                x: 400.0,
                y: 5000.0,
            },
            BUILT_IN,
        );
        assert_eq!(too_low.y, BUILT_IN.height - REACH);
    }

    #[test]
    fn clamp_leaves_a_valid_position_alone() {
        let inside = Point { x: 300.0, y: 120.0 };
        assert_eq!(clamp_origin(inside, BUILT_IN), inside);
    }

    #[test]
    fn no_monitors_means_no_placement() {
        assert_eq!(resolve_origin(&Settings::default(), &[], 0), None);
    }
}
