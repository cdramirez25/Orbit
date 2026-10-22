use tauri::{AppHandle, Manager};

use super::CommandError;
use crate::shortcuts::{RegisteredShortcuts, ShortcutInfo};
use crate::tray::{self, TrayLabels};

/// Los atajos globales y si se pudieron registrar.
#[tauri::command]
pub fn get_shortcuts(app: AppHandle) -> Vec<ShortcutInfo> {
    app.state::<RegisteredShortcuts>().all()
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
