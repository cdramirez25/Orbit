//! Código específico de cada sistema operativo de la batería. Solo aquí (y bajo
//! `#[cfg(target_os = "...")]`): preguntarle al sistema por la batería del equipo.

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
use self::macos as current;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
use self::windows as current;

use super::{Battery, BatteryProbe};

/// Adaptador: la batería del sistema operativo.
pub struct SystemBattery;

impl BatteryProbe for SystemBattery {
    fn read(&self) -> Option<Battery> {
        current::read()
    }
}
