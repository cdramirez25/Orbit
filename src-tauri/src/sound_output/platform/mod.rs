//! Código específico de cada sistema operativo de la salida de sonido. Solo aquí (y bajo
//! `#[cfg(target_os = "...")]`): leer los dispositivos y cambiar el predeterminado.

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
use self::macos as current;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
use self::windows as current;

use super::{OutputDevice, OutputSwitch, SoundOutputError};

/// Adaptador: las salidas de sonido del sistema operativo.
pub struct SystemOutputSwitch;

impl OutputSwitch for SystemOutputSwitch {
    fn list(&self) -> Result<Vec<OutputDevice>, SoundOutputError> {
        current::list()
    }

    fn set_default(&self, id: &str) -> Result<(), SoundOutputError> {
        current::set_default(id)
    }
}
