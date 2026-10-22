//! macOS: Ajustes del Sistema → Privacidad y seguridad → Cámara.

use std::process::Command;

use crate::camera::CameraError;

const SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera";

pub fn open_privacy_settings() -> Result<(), CameraError> {
    let status = Command::new("open")
        .arg(SETTINGS_URL)
        .status()
        .map_err(|error| CameraError::OpenSettings(error.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(CameraError::OpenSettings(format!(
            "`open` terminó con {status}"
        )))
    }
}
