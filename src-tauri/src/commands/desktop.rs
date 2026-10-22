use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use super::CommandError;
use crate::app_state::AppState;
use crate::events::UiAction;
use crate::settings::Settings;
use crate::shortcuts::{self, RegisteredShortcuts, ShortcutInfo};
use crate::tray::{self, TrayLabels};

/// Los atajos globales y si se pudieron registrar.
#[tauri::command]
pub fn get_shortcuts(app: AppHandle) -> Vec<ShortcutInfo> {
    app.state::<RegisteredShortcuts>().all()
}

/// Cambia el atajo de una acción (y lo guarda). Con una combinación que no sirve o que otra app ya
/// usa, rechaza con su código y se queda el de antes.
#[tauri::command]
pub fn set_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    action: UiAction,
    keys: String,
) -> Result<Vec<ShortcutInfo>, CommandError> {
    let infos = shortcuts::change(&app, action, &keys)?;
    remember_shortcut(&state, action, keys.trim());
    Ok(infos)
}

/// Devuelve el atajo de una acción al de por defecto.
#[tauri::command]
pub fn reset_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    action: UiAction,
) -> Result<Vec<ShortcutInfo>, CommandError> {
    let default = shortcuts::default_keys(action);
    let infos = shortcuts::change(&app, action, default)?;
    remember_shortcut(&state, action, default);
    Ok(infos)
}

/// Guarda el atajo elegido; si es el de por defecto, no se guarda nada (así un cambio futuro del
/// valor por defecto le llega a quien nunca lo tocó).
fn remember_shortcut(state: &AppState, action: UiAction, keys: &str) {
    state.update_settings(|settings| {
        if keys == shortcuts::default_keys(action) {
            settings.shortcuts.remove(&action);
        } else {
            settings.shortcuts.insert(action, keys.to_owned());
        }
    });
}

/// Rotula el menú de la bandeja (y la crea la primera vez) con los textos del idioma activo.
/// Es síncrono: el menú nativo se toca desde el hilo principal.
#[tauri::command]
pub fn set_tray_labels(app: AppHandle, labels: TrayLabels) -> Result<(), CommandError> {
    tray::apply(&app, &labels).inspect_err(|error| {
        tracing::warn!(%error, "no se pudo preparar la bandeja del sistema");
    })?;
    Ok(())
}

/// ¿Orbit se abre solo al iniciar sesión? Lo dice el sistema, no un ajuste guardado: si el usuario
/// lo quita desde Ajustes del Sistema, aquí se ve apagado.
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, CommandError> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| CommandError::Autostart(error.to_string()))
}

/// Enciende o apaga el inicio con la sesión y devuelve cómo quedó.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, CommandError> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|error| CommandError::Autostart(error.to_string()))?;
    manager
        .is_enabled()
        .map_err(|error| CommandError::Autostart(error.to_string()))
}

/// Marca la guía de primer arranque como vista (o la vuelve a activar).
#[tauri::command]
pub fn set_onboarding_done(state: State<'_, AppState>, done: bool) -> Settings {
    state.update_settings(|settings| settings.onboarding_done = done)
}
