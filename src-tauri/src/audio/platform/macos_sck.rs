//! macOS: el audio del sistema se captura con ScreenCaptureKit, que exige el permiso de
//! "Grabación de pantalla". (La alternativa, los process taps de Core Audio, pide otro permiso
//! distinto y solo existe desde macOS 14.2; se valorará más adelante.)
//!
//! OJO en desarrollo: con `pnpm tauri dev` el binario cuelga de la terminal (o de la app que la
//! lanza), y macOS atribuye el permiso a ESA app, no a "orbit". Hay que concederlo a la terminal.

use std::io;
use std::process::Command;

use crate::audio::permission::AudioPermission;
use crate::audio::AudioError;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// macOS 10.15+. ¿Está concedido el permiso? No muestra ningún aviso.
    fn CGPreflightScreenCaptureAccess() -> bool;
    /// macOS 10.15+. Muestra el aviso del sistema la primera vez; devuelve si ya está concedido.
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Panel "Grabación de pantalla" de Ajustes del Sistema.
const SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

pub struct SystemAudioPermission;

impl AudioPermission for SystemAudioPermission {
    fn required(&self) -> bool {
        true
    }

    fn is_granted(&self) -> bool {
        // SAFETY: función de CoreGraphics sin argumentos ni efectos sobre memoria de Rust.
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    fn request(&self) -> bool {
        // SAFETY: igual que arriba; solo puede mostrar el aviso del sistema.
        unsafe { CGRequestScreenCaptureAccess() }
    }

    fn open_system_settings(&self) -> Result<(), AudioError> {
        let status = Command::new("open").arg(SETTINGS_URL).status()?;
        if status.success() {
            Ok(())
        } else {
            Err(AudioError::OpenSettings(io::Error::other(format!(
                "`open` terminó con {status}"
            ))))
        }
    }
}
