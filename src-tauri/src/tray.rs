//! Icono de la bandeja del sistema (barra de menú en macOS, área de notificaciones en Windows):
//! adaptador de entrada (§4.0). Sus opciones no hacen nada por sí mismas: piden a la isla o abren
//! la ventana de ajustes.
//!
//! El menú es nativo y no puede usar los textos de la interfaz, así que nace cuando la interfaz le
//! manda sus rótulos ya traducidos (`apply`) y se vuelve a rotular cada vez que cambia el idioma.

use std::sync::{Mutex, PoisonError};

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager, Wry};

use crate::app_state::AppState;
use crate::events::{DomainEvent, UiAction};
use crate::window::settings_window;

const TRAY_ID: &str = "orbit";
const TOGGLE_ISLAND: &str = "toggle-island";
const OPEN_SETTINGS: &str = "open-settings";
const QUIT: &str = "quit";

/// Rótulos del menú, en el idioma de la interfaz.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    pub toggle_island: String,
    pub settings: String,
    pub quit: String,
}

struct Tray {
    toggle_island: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    /// Si se suelta, el icono desaparece de la bandeja.
    _icon: TrayIcon,
}

#[derive(Default)]
pub struct TrayState(Mutex<Option<Tray>>);

/// Crea el icono la primera vez; las siguientes solo cambia los rótulos.
pub fn apply(app: &AppHandle, labels: &TrayLabels) -> tauri::Result<()> {
    let state = app.state::<TrayState>();
    let mut tray = state.0.lock().unwrap_or_else(PoisonError::into_inner);
    match tray.as_ref() {
        Some(existing) => {
            existing.toggle_island.set_text(&labels.toggle_island)?;
            existing.settings.set_text(&labels.settings)?;
            existing.quit.set_text(&labels.quit)?;
        }
        None => {
            *tray = Some(create(app, labels)?);
            tracing::info!("bandeja del sistema lista");
        }
    }
    Ok(())
}

fn create(app: &AppHandle, labels: &TrayLabels) -> tauri::Result<Tray> {
    let toggle_island = MenuItem::with_id(
        app,
        TOGGLE_ISLAND,
        &labels.toggle_island,
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, OPEN_SETTINGS, &labels.settings, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, &labels.quit, true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle_island,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let icon = TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::include_image!("icons/tray.png"))
        .tooltip("Orbit")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TOGGLE_ISLAND => app
                .state::<AppState>()
                .events
                .publish(DomainEvent::UiAction(UiAction::ToggleIsland)),
            OPEN_SETTINGS => {
                let hide = app.state::<AppState>().settings().hide_from_screen_share;
                if let Err(error) = settings_window::open(app, hide) {
                    tracing::warn!(%error, "no se pudo abrir los ajustes desde la bandeja");
                }
            }
            QUIT => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(Tray {
        toggle_island,
        settings,
        quit,
        _icon: icon,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_come_from_the_frontend_in_camel_case() {
        let labels: TrayLabels = serde_json::from_str(
            r#"{ "toggleIsland": "Mostrar", "settings": "Ajustes", "quit": "Salir" }"#,
        )
        .unwrap();
        assert_eq!(labels.toggle_island, "Mostrar");
        assert_eq!(labels.quit, "Salir");
    }

    #[test]
    fn the_menu_ids_are_distinct() {
        assert_ne!(TOGGLE_ISLAND, OPEN_SETTINGS);
        assert_ne!(OPEN_SETTINGS, QUIT);
        assert_ne!(TOGGLE_ISLAND, QUIT);
    }
}
