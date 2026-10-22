use tauri::State;

use super::CommandError;
use crate::app_state::AppState;
use crate::keep_awake::{KeepAwakeSetting, KeepAwakeStatus};

/// El modo de pantalla encendida y si está manteniéndose ahora mismo.
#[tauri::command]
pub fn keep_awake_status(state: State<'_, AppState>) -> KeepAwakeStatus {
    state.awake.status()
}

/// Cambia el modo (apagado, siempre, un tiempo o un horario diario), lo aplica ya y lo guarda: así
/// "siempre" y los horarios se retoman al abrir Orbit. Los cambios que vengan después (se acabó el
/// tiempo, empezó el horario) llegan por el evento `awake:changed`.
#[tauri::command]
pub fn keep_awake_set(
    state: State<'_, AppState>,
    setting: KeepAwakeSetting,
) -> Result<KeepAwakeStatus, CommandError> {
    let status = state.awake.set(setting)?;
    state.update_settings(|settings| settings.keep_awake = status.setting.clone());
    Ok(status)
}
