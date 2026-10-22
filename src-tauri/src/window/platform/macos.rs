//! macOS: la isla es un `NSPanel` non-activating (no roba foco), visible en todos los Spaces y
//! sobre apps a pantalla completa, por encima de la barra de menús.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{ActivationPolicy, AppHandle, WebviewUrl};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask,
};

use crate::window::island_window::{overlay_options, LABEL};
use crate::window::notch::{notch_from_metrics, NotchInfo, ScreenFrame};

/// Nivel de ventana: `NSMainMenuWindowLevel` (24) + 3, para quedar sobre la barra de menús y
/// el área del notch.
const ISLAND_LEVEL: i32 = 27;

/// ¿Puede la isla recibir el teclado ahora? Casi siempre no (no debe quitarle el foco a la
/// videollamada); solo mientras el usuario escribe en su campo de pregunta.
static KEYBOARD: AtomicBool = AtomicBool::new(false);

tauri_panel! {
    panel!(IslandPanel {
        config: {
            // Sin foco de teclado salvo mientras se escribe (`set_island_keyboard`).
            can_become_key_window: KEYBOARD.load(Ordering::SeqCst),
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

pub fn prepare_app(app: &mut tauri::App) -> tauri::Result<()> {
    // Sin icono en el Dock ni en Cmd+Tab.
    app.set_activation_policy(ActivationPolicy::Accessory);
    app.handle().plugin(tauri_nspanel::init())?;
    Ok(())
}

pub fn create_island(app: &AppHandle) -> tauri::Result<()> {
    PanelBuilder::<_, IslandPanel>::new(app, LABEL)
        .url(WebviewUrl::App("island.html".into()))
        .level(PanelLevel::Custom(ISLAND_LEVEL))
        .has_shadow(false)
        .transparent(true)
        .add_style_mask(StyleMask::empty().nonactivating_panel())
        .collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary()
                .stationary()
                .ignores_cycle(),
        )
        .no_activate(true)
        .with_window(|window| overlay_options(window).accept_first_mouse(true))
        .build()?;
    Ok(())
}

/// Deja que la isla reciba el teclado (`true`, mientras el usuario escribe una pregunta) o se lo
/// devuelve a la app de antes (`false`). Debe llamarse desde el hilo principal.
pub fn set_island_keyboard(app: &AppHandle, enabled: bool) -> tauri::Result<()> {
    KEYBOARD.store(enabled, Ordering::SeqCst);
    if let Ok(panel) = app.get_webview_panel(LABEL) {
        if enabled {
            panel.make_key_window();
        } else {
            panel.resign_key_window();
        }
    }
    Ok(())
}

/// Dónde está el puntero respecto a la esquina superior izquierda de la ventana de la isla, en
/// puntos lógicos (`x` a la derecha, `y` hacia abajo).
///
/// No se usa `cursor_position` de Tauri: en macOS lo pasa a píxeles con la escala del monitor
/// *principal*, mientras que la posición de la ventana usa la escala de *su* monitor. Con dos
/// pantallas de escala distinta (un portátil Retina y un monitor externo) el resultado queda corrido
/// y la isla "no ve" el mouse. AppKit da el puntero y la ventana en puntos, en el mismo espacio.
pub fn pointer_in_island(app: &AppHandle) -> tauri::Result<(f64, f64)> {
    let panel = app
        .get_webview_panel(LABEL)
        .map_err(|_| tauri::Error::WindowNotFound)?;
    let frame = panel.as_panel().frame();
    let mouse = NSEvent::mouseLocation();
    Ok(pointer_in_frame(
        (mouse.x, mouse.y),
        (
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height,
        ),
    ))
}

/// Pasa el puntero (puntos globales de AppKit, con el origen abajo a la izquierda de la pantalla
/// principal) a puntos dentro de la ventana, con el origen arriba a la izquierda. `frame` es
/// `(x, y, ancho, alto)`, también de AppKit.
fn pointer_in_frame(mouse: (f64, f64), frame: (f64, f64, f64, f64)) -> (f64, f64) {
    let (x, y, _, height) = frame;
    (mouse.0 - x, (y + height) - mouse.1)
}

pub fn show_island(app: &AppHandle) -> tauri::Result<()> {
    if let Ok(panel) = app.get_webview_panel(LABEL) {
        panel.show();
    }
    Ok(())
}

/// Lee el notch de la pantalla en la que está la isla. Debe llamarse desde el hilo principal
/// (los comandos síncronos de Tauri ya corren ahí).
pub fn notch_info(app: &AppHandle) -> NotchInfo {
    let fallback = ScreenFrame {
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 0.0,
    };

    // `MainThreadMarker` y `NSRect` ya los trae a este módulo el macro `tauri_panel!`.
    if MainThreadMarker::new().is_none() {
        return NotchInfo::none(fallback);
    }
    let Ok(panel) = app.get_webview_panel(LABEL) else {
        return NotchInfo::none(fallback);
    };
    let Some(screen) = panel.as_panel().screen() else {
        return NotchInfo::none(fallback);
    };

    let frame = screen.frame();
    let screen_frame = ScreenFrame {
        x: frame.origin.x,
        y: frame.origin.y,
        width: frame.size.width,
        height: frame.size.height,
    };
    let width_of = |rect: NSRect| rect.size.width;

    notch_from_metrics(
        screen_frame,
        screen.safeAreaInsets().top,
        width_of(screen.auxiliaryTopLeftArea()),
        width_of(screen.auxiliaryTopRightArea()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ventana de 640×520 con su esquina superior izquierda en (415, 0) de la pantalla principal
    /// (de 956 pt de alto): en AppKit su origen está abajo, en y = 956 - 520 = 436.
    const ON_PRIMARY: (f64, f64, f64, f64) = (415.0, 436.0, 640.0, 520.0);

    #[test]
    fn the_pointer_is_measured_from_the_top_left_corner_of_the_window() {
        // Justo en la esquina superior izquierda de la ventana.
        assert_eq!(pointer_in_frame((415.0, 956.0), ON_PRIMARY), (0.0, 0.0));
        // 100 pt a la derecha y 40 pt hacia abajo.
        assert_eq!(pointer_in_frame((515.0, 916.0), ON_PRIMARY), (100.0, 40.0));
    }

    #[test]
    fn the_pointer_outside_the_window_is_negative() {
        let (x, y) = pointer_in_frame((300.0, 980.0), ON_PRIMARY);
        assert_eq!((x, y), (-115.0, -24.0));
    }

    #[test]
    fn a_window_on_a_second_display_uses_the_same_global_points() {
        // Monitor externo a la derecha (x desde 1470) y 124 pt más abajo que el borde superior de la
        // principal: su ventana, con la esquina superior en y = 124 - 0, tiene el origen AppKit en
        // 956 - 124 - 520 = 312. Da igual la escala de cada pantalla: todo va en puntos.
        let frame = (2110.0, 312.0, 640.0, 520.0);
        assert_eq!(pointer_in_frame((2210.0, 784.0), frame), (100.0, 48.0));
    }

    #[test]
    fn a_window_on_a_display_to_the_left_has_negative_global_x() {
        let frame = (-1505.0, 436.0, 640.0, 520.0);
        assert_eq!(pointer_in_frame((-1405.0, 916.0), frame), (100.0, 40.0));
    }
}
