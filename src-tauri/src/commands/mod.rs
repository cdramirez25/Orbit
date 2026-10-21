//! Comandos de Tauri (adaptadores de entrada): finos, validan, llaman al núcleo y devuelven.
//! Sin lógica de negocio.

pub mod audio;
pub mod island;
pub mod pipeline;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("error de ventana: {0}")]
    Window(#[from] tauri::Error),
    #[error("error de audio: {0}")]
    Audio(#[from] crate::audio::AudioError),
}

impl CommandError {
    /// Código estable que la interfaz usa para elegir el mensaje (no depende del texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Window(_) => "window",
            Self::Audio(error) => error.code(),
        }
    }
}

/// Se serializa como `{ code, message }` para que la interfaz distinga el error sin leer texto.
impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("CommandError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::audio::AudioError;

    #[test]
    fn audio_errors_keep_their_stable_code() {
        let error = CommandError::from(AudioError::PermissionDenied);
        assert_eq!(error.code(), "audio.permissionDenied");
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            json!({
                "code": "audio.permissionDenied",
                "message": "error de audio: falta el permiso para capturar el audio del sistema"
            })
        );
    }

    #[test]
    fn window_errors_have_their_own_code() {
        let error = CommandError::from(tauri::Error::WindowNotFound);
        assert_eq!(error.code(), "window");
    }
}
