//! Windows: Configuración → Privacidad → Cámara. Verificar a mano.

use std::process::Command;

use crate::camera::CameraError;

const SETTINGS_URL: &str = "ms-settings:privacy-webcam";

pub fn open_privacy_settings() -> Result<(), CameraError> {
    // `explorer` abre el enlace sin dejar una ventana de consola.
    Command::new("explorer")
        .arg(SETTINGS_URL)
        .spawn()
        .map(|_| ())
        .map_err(|error| CameraError::OpenSettings(error.to_string()))
}
