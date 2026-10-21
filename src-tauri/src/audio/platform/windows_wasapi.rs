//! Windows: la captura del audio de salida (WASAPI loopback del dispositivo predeterminado) no
//! pide ningún permiso al usuario ni muestra avisos. Verificar a mano en Windows 10 2004+ / 11.

use crate::audio::permission::AudioPermission;
use crate::audio::AudioError;

pub struct SystemAudioPermission;

impl AudioPermission for SystemAudioPermission {
    fn required(&self) -> bool {
        false
    }

    fn is_granted(&self) -> bool {
        true
    }

    fn request(&self) -> bool {
        true
    }

    fn open_system_settings(&self) -> Result<(), AudioError> {
        // No hay nada que conceder: no existe una pantalla a la que mandar al usuario.
        Ok(())
    }
}
