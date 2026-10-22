//! Atajos globales del teclado (adaptador de entrada, §4.0): funcionan con cualquier app en primer
//! plano. No hacen nada por sí mismos: publican un `UiAction` y la isla lo ejecuta.
//!
//! `CommandOrControl` es Cmd en macOS y Ctrl en Windows. Si otra app ya tiene la combinación, ese
//! atajo queda sin registrar (`registered: false`) y el resto sigue funcionando.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::app_state::AppState;
use crate::events::{DomainEvent, UiAction};

/// Cada atajo y lo que pide: empezar/terminar la pregunta y mostrar/ocultar la isla.
const BINDINGS: [(UiAction, &str); 2] = [
    (UiAction::ToggleQuestion, "CommandOrControl+Shift+Space"),
    (UiAction::ToggleIsland, "CommandOrControl+Shift+H"),
];

/// Un atajo y si se pudo registrar (espejo de `src/types/shortcuts.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutInfo {
    pub action: UiAction,
    /// Combinación (`CommandOrControl+Shift+Space`); la interfaz la muestra según el sistema.
    pub keys: String,
    pub registered: bool,
}

/// Lo que se registró al arrancar, para que Ajustes lo muestre.
#[derive(Default)]
pub struct RegisteredShortcuts(Mutex<Vec<ShortcutInfo>>);

impl RegisteredShortcuts {
    pub fn all(&self) -> Vec<ShortcutInfo> {
        self.0
            .lock()
            .map(|shortcuts| shortcuts.clone())
            .unwrap_or_default()
    }
}

/// Instala el plugin y registra los atajos. Un fallo no impide arrancar: solo se anota.
pub fn register(app: &AppHandle) {
    let mut infos: Vec<ShortcutInfo> = BINDINGS
        .iter()
        .map(|(action, keys)| ShortcutInfo {
            action: *action,
            keys: (*keys).to_owned(),
            registered: false,
        })
        .collect();

    match app
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .map(|()| app.global_shortcut())
    {
        Err(error) => tracing::warn!(%error, "no se pudo activar los atajos globales"),
        Ok(shortcuts) => {
            for info in &mut infos {
                let action = info.action;
                let result = shortcuts.on_shortcut(info.keys.as_str(), move |app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        publish(app, action);
                    }
                });
                match result {
                    Ok(()) => info.registered = true,
                    Err(error) => {
                        tracing::warn!(keys = %info.keys, %error, "no se pudo registrar el atajo");
                    }
                }
            }
        }
    }

    tracing::info!(
        registered = infos.iter().filter(|info| info.registered).count(),
        total = infos.len(),
        "atajos globales"
    );
    app.manage(RegisteredShortcuts(Mutex::new(infos)));
}

fn publish(app: &AppHandle, action: UiAction) {
    app.state::<AppState>()
        .events
        .publish(DomainEvent::UiAction(action));
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use tauri_plugin_global_shortcut::Shortcut;

    use super::*;

    #[test]
    fn every_binding_is_a_valid_combination() {
        for (_, keys) in BINDINGS {
            assert!(Shortcut::from_str(keys).is_ok(), "{keys} no es válido");
        }
    }

    #[test]
    fn the_bindings_do_not_collide() {
        let first = Shortcut::from_str(BINDINGS[0].1).unwrap();
        let second = Shortcut::from_str(BINDINGS[1].1).unwrap();
        assert_ne!(first.id(), second.id());
    }

    #[test]
    fn each_action_has_exactly_one_binding() {
        assert_eq!(BINDINGS[0].0, UiAction::ToggleQuestion);
        assert_eq!(BINDINGS[1].0, UiAction::ToggleIsland);
    }

    #[test]
    fn the_wire_format_matches_the_frontend() {
        let info = ShortcutInfo {
            action: UiAction::ToggleQuestion,
            keys: "CommandOrControl+Shift+Space".into(),
            registered: true,
        };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({
                "action": "toggleQuestion",
                "keys": "CommandOrControl+Shift+Space",
                "registered": true
            })
        );
    }
}
