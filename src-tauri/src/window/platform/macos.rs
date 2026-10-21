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
