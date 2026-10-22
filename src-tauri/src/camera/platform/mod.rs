//! Código específico de plataforma de la cámara. Solo aquí (y bajo `#[cfg(target_os = "...")]`).

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
pub use self::macos as current;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub use self::windows as current;

use super::CameraError;

/// Abre la pantalla de privacidad del sistema donde se concede el permiso de la cámara.
pub fn open_privacy_settings() -> Result<(), CameraError> {
    current::open_privacy_settings()
}
