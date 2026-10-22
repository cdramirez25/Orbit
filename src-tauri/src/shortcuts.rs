//! Atajos globales del teclado (adaptador de entrada, §4.0): funcionan con cualquier app en primer
//! plano. No hacen nada por sí mismos: publican un `UiAction` y la isla lo ejecuta.
//!
//! Cada acción tiene un atajo por defecto y el usuario puede cambiarlo (se guarda en los ajustes).
//! `CommandOrControl` es Cmd en macOS y Ctrl en Windows. Si otra app ya tiene la combinación, ese
//! atajo queda sin registrar (`registered: false`) y el resto sigue funcionando.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::app_state::AppState;
use crate::events::{DomainEvent, UiAction};

/// Cada acción y su atajo por defecto: empezar/terminar la pregunta y mostrar/ocultar la isla.
const DEFAULTS: [(UiAction, &str); 2] = [
    (UiAction::ToggleQuestion, "CommandOrControl+Shift+Space"),
    (UiAction::ToggleIsland, "CommandOrControl+Shift+H"),
];

/// El atajo por defecto de una acción.
pub fn default_keys(action: UiAction) -> &'static str {
    DEFAULTS
        .iter()
        .find(|(candidate, _)| *candidate == action)
        .map_or("", |(_, keys)| keys)
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ShortcutError {
    #[error("la combinación de teclas no es válida")]
    Invalid,
    #[error("el atajo necesita al menos una tecla modificadora (Cmd, Ctrl, Alt o Shift)")]
    NeedsModifier,
    #[error("otra acción de Orbit ya usa ese atajo")]
    Duplicate,
    #[error("otra app ya usa ese atajo")]
    Unavailable,
}

impl ShortcutError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Invalid => "shortcut.invalid",
            Self::NeedsModifier => "shortcut.needsModifier",
            Self::Duplicate => "shortcut.duplicate",
            Self::Unavailable => "shortcut.unavailable",
        }
    }
}

/// Un atajo y si se pudo registrar (espejo de `src/types/shortcuts.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutInfo {
    pub action: UiAction,
    /// Combinación (`CommandOrControl+Shift+Space`); la interfaz la muestra según el sistema.
    pub keys: String,
    /// La combinación por defecto de esta acción (para "Restablecer").
    pub default_keys: String,
    /// `false` si otra app ya usa la combinación.
    pub registered: bool,
}

/// Lo que está registrado ahora, para que Ajustes lo muestre y para poder cambiarlo.
#[derive(Default)]
pub struct RegisteredShortcuts(Mutex<Vec<ShortcutInfo>>);

impl RegisteredShortcuts {
    pub fn all(&self) -> Vec<ShortcutInfo> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn replace(&self, infos: Vec<ShortcutInfo>) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = infos;
    }
}

/// Lee una combinación y comprueba que sirve como atajo global: que se entienda y que lleve al
/// menos un modificador (una tecla suelta, como la `H`, dispararía el atajo al escribir).
pub fn parse(keys: &str) -> Result<Shortcut, ShortcutError> {
    let shortcut: Shortcut = keys.trim().parse().map_err(|_| ShortcutError::Invalid)?;
    if shortcut.mods.is_empty() {
        return Err(ShortcutError::NeedsModifier);
    }
    Ok(shortcut)
}

/// Comprueba que `keys` sirve para `action` sin chocar con el atajo de otra acción.
pub fn validate(
    current: &[ShortcutInfo],
    action: UiAction,
    keys: &str,
) -> Result<Shortcut, ShortcutError> {
    let shortcut = parse(keys)?;
    let taken = current
        .iter()
        .filter(|info| info.action != action)
        .filter_map(|info| parse(&info.keys).ok())
        .any(|other| other.id() == shortcut.id());
    if taken {
        return Err(ShortcutError::Duplicate);
    }
    Ok(shortcut)
}

/// El atajo que se debe intentar registrar para cada acción al arrancar: el guardado si se entiende,
/// y si no, el de por defecto.
fn initial_keys(saved: &HashMap<UiAction, String>, action: UiAction) -> String {
    saved
        .get(&action)
        .filter(|keys| parse(keys).is_ok())
        .cloned()
        .unwrap_or_else(|| default_keys(action).to_owned())
}

fn info(action: UiAction, keys: String, registered: bool) -> ShortcutInfo {
    ShortcutInfo {
        action,
        keys,
        default_keys: default_keys(action).to_owned(),
        registered,
    }
}

fn bind(app: &AppHandle, action: UiAction, keys: &str) -> Result<(), ShortcutError> {
    app.global_shortcut()
        .on_shortcut(keys, move |app, _, event| {
            if event.state == ShortcutState::Pressed {
                publish(app, action);
            }
        })
        .map_err(|_| ShortcutError::Unavailable)
}

/// Instala el plugin y registra los atajos (los guardados o los de por defecto). Un fallo no
/// impide arrancar: solo se anota.
pub fn register(app: &AppHandle, saved: &HashMap<UiAction, String>) {
    let plugin = app.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    if let Err(error) = &plugin {
        tracing::warn!(%error, "no se pudo activar los atajos globales");
    }

    let infos: Vec<ShortcutInfo> = DEFAULTS
        .iter()
        .map(|(action, _)| {
            let keys = initial_keys(saved, *action);
            let registered = plugin.is_ok()
                && bind(app, *action, &keys)
                    .inspect_err(|_| tracing::warn!(%keys, "no se pudo registrar el atajo"))
                    .is_ok();
            info(*action, keys, registered)
        })
        .collect();

    tracing::info!(
        registered = infos.iter().filter(|info| info.registered).count(),
        total = infos.len(),
        "atajos globales"
    );
    app.manage(RegisteredShortcuts::default());
    app.state::<RegisteredShortcuts>().replace(infos);
}

/// Cambia el atajo de una acción. Si la combinación no sirve o la tiene otra app, se queda el de
/// antes. Devuelve la lista completa ya actualizada.
pub fn change(
    app: &AppHandle,
    action: UiAction,
    keys: &str,
) -> Result<Vec<ShortcutInfo>, ShortcutError> {
    let state = app.state::<RegisteredShortcuts>();
    let current = state.all();
    validate(&current, action, keys)?;
    let Some(old) = current.iter().find(|info| info.action == action) else {
        return Err(ShortcutError::Invalid);
    };

    // Primero se suelta el de antes (si estaba registrado): una combinación solo se puede tomar una vez.
    if old.registered {
        if let Ok(previous) = parse(&old.keys) {
            let _ = app.global_shortcut().unregister(previous);
        }
    }
    if let Err(error) = bind(app, action, keys.trim()) {
        // Otra app la tiene: se vuelve a registrar el de antes para no dejar la acción sin atajo.
        if old.registered {
            let _ = bind(app, action, &old.keys);
        }
        return Err(error);
    }

    let infos: Vec<ShortcutInfo> = current
        .into_iter()
        .map(|existing| {
            if existing.action == action {
                info(action, keys.trim().to_owned(), true)
            } else {
                existing
            }
        })
        .collect();
    state.replace(infos.clone());
    Ok(infos)
}

fn publish(app: &AppHandle, action: UiAction) {
    app.state::<AppState>()
        .events
        .publish(DomainEvent::UiAction(action));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn infos(question: &str, island: &str) -> Vec<ShortcutInfo> {
        vec![
            info(UiAction::ToggleQuestion, question.to_owned(), true),
            info(UiAction::ToggleIsland, island.to_owned(), true),
        ]
    }

    #[test]
    fn every_default_is_a_valid_combination_and_they_do_not_collide() {
        let ids: Vec<u32> = DEFAULTS
            .iter()
            .map(|(_, keys)| {
                parse(keys)
                    .unwrap_or_else(|_| panic!("{keys} no es válido"))
                    .id()
            })
            .collect();
        assert_ne!(ids[0], ids[1]);
    }

    #[test]
    fn each_action_has_its_default() {
        assert_eq!(
            default_keys(UiAction::ToggleQuestion),
            "CommandOrControl+Shift+Space"
        );
        assert_eq!(
            default_keys(UiAction::ToggleIsland),
            "CommandOrControl+Shift+H"
        );
    }

    #[test]
    fn a_shortcut_needs_a_known_key_and_at_least_one_modifier() {
        assert!(parse("CommandOrControl+Shift+K").is_ok());
        assert!(parse(" Alt+F5 ").is_ok(), "los espacios de más no estorban");
        assert!(parse("Control+Alt+ArrowUp").is_ok());
        assert_eq!(parse("H"), Err(ShortcutError::NeedsModifier));
        assert_eq!(parse("F5"), Err(ShortcutError::NeedsModifier));
        assert_eq!(parse("Cmd+Banana"), Err(ShortcutError::Invalid));
        assert_eq!(parse(""), Err(ShortcutError::Invalid));
        assert_eq!(parse("Shift"), Err(ShortcutError::Invalid));
    }

    #[test]
    fn every_key_name_the_interface_can_send_is_understood() {
        // La interfaz manda el `code` del teclado del navegador (sin el prefijo `Key`/`Digit` en
        // letras y números). Si alguno dejara de entenderse, el usuario no podría elegirlo.
        let keys = [
            "A",
            "Z",
            "0",
            "9",
            "F1",
            "F12",
            "F24",
            "Space",
            "Enter",
            "Tab",
            "Backspace",
            "Delete",
            "Insert",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Minus",
            "Equal",
            "BracketLeft",
            "BracketRight",
            "Backslash",
            "Semicolon",
            "Quote",
            "Comma",
            "Period",
            "Slash",
            "Backquote",
            "Numpad0",
            "Numpad9",
            "NumpadAdd",
        ];
        for key in keys {
            let combo = format!("CommandOrControl+Alt+{key}");
            assert!(parse(&combo).is_ok(), "{combo} no se entiende");
        }
        for modifier in ["Control", "Alt", "Shift", "Super", "CommandOrControl"] {
            let combo = format!("{modifier}+K");
            assert!(parse(&combo).is_ok(), "{combo} no se entiende");
        }
    }

    #[test]
    fn the_same_combination_written_in_another_order_is_the_same_shortcut() {
        let current = infos("CommandOrControl+Shift+Space", "CommandOrControl+Shift+H");
        assert_eq!(
            validate(
                &current,
                UiAction::ToggleQuestion,
                "Shift+CommandOrControl+H"
            ),
            Err(ShortcutError::Duplicate)
        );
    }

    #[test]
    fn an_action_can_keep_or_re_enter_its_own_combination() {
        let current = infos("CommandOrControl+Shift+Space", "CommandOrControl+Shift+H");
        assert!(validate(&current, UiAction::ToggleIsland, "CommandOrControl+Shift+H").is_ok());
        assert!(validate(&current, UiAction::ToggleIsland, "Alt+H").is_ok());
    }

    #[test]
    fn saved_shortcuts_win_but_a_broken_one_falls_back_to_the_default() {
        let saved = HashMap::from([
            (UiAction::ToggleQuestion, "Alt+Q".to_owned()),
            (UiAction::ToggleIsland, "esto no es un atajo".to_owned()),
        ]);
        assert_eq!(initial_keys(&saved, UiAction::ToggleQuestion), "Alt+Q");
        assert_eq!(
            initial_keys(&saved, UiAction::ToggleIsland),
            "CommandOrControl+Shift+H"
        );
        assert_eq!(
            initial_keys(&HashMap::new(), UiAction::ToggleQuestion),
            "CommandOrControl+Shift+Space"
        );
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(ShortcutError::Invalid.code(), "shortcut.invalid");
        assert_eq!(
            ShortcutError::NeedsModifier.code(),
            "shortcut.needsModifier"
        );
        assert_eq!(ShortcutError::Duplicate.code(), "shortcut.duplicate");
        assert_eq!(ShortcutError::Unavailable.code(), "shortcut.unavailable");
    }

    #[test]
    fn the_wire_format_matches_the_frontend() {
        let info = info(UiAction::ToggleQuestion, "Alt+Q".into(), true);
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({
                "action": "toggleQuestion",
                "keys": "Alt+Q",
                "defaultKeys": "CommandOrControl+Shift+Space",
                "registered": true
            })
        );
    }
}
