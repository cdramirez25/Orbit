//! Comandos de Tauri (adaptadores de entrada): finos, validan, llaman al núcleo y devuelven.
//! Sin lógica de negocio.

pub mod ai;
pub mod audio;
pub mod awake;
pub mod camera;
pub mod clipboard;
pub mod desktop;
pub mod island;
pub mod media;
pub mod pipeline;
pub mod sessions;
pub mod settings_window;
pub mod stt;
pub mod weather;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("error de ventana: {0}")]
    Window(#[from] tauri::Error),
    #[error("error de audio: {0}")]
    Audio(#[from] crate::audio::AudioError),
    #[error("error del clima: {0}")]
    Weather(#[from] crate::weather::WeatherError),
    #[error("error del portapapeles: {0}")]
    Clipboard(#[from] crate::clipboard::ClipboardError),
    #[error("error de la música: {0}")]
    Media(#[from] crate::media::MediaError),
    #[error("error de la IA: {0}")]
    Ai(#[from] crate::ai::AiError),
    #[error("error de la sesión: {0}")]
    Session(#[from] crate::sessions::SessionError),
    #[error("error del modelo de transcripción: {0}")]
    Model(#[from] crate::stt::model::ModelError),
    #[error("error del atajo: {0}")]
    Shortcut(#[from] crate::shortcuts::ShortcutError),
    #[error("no se pudo cambiar el inicio con la sesión: {0}")]
    Autostart(String),
    #[error("error de la pantalla encendida: {0}")]
    KeepAwake(#[from] crate::keep_awake::KeepAwakeError),
    #[error("error de la cámara: {0}")]
    Camera(#[from] crate::camera::CameraError),
}

impl CommandError {
    /// Código estable que la interfaz usa para elegir el mensaje (no depende del texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Window(_) => "window",
            Self::Audio(error) => error.code(),
            Self::Weather(error) => error.code(),
            Self::Clipboard(error) => error.code(),
            Self::Media(error) => error.code(),
            Self::Ai(error) => error.code(),
            Self::Session(error) => error.code(),
            Self::Model(error) => error.code(),
            Self::Shortcut(error) => error.code(),
            Self::Autostart(_) => "autostart.failed",
            Self::KeepAwake(error) => error.code(),
            Self::Camera(error) => error.code(),
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
    use crate::clipboard::ClipboardError;
    use crate::weather::WeatherError;

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

    #[test]
    fn ai_errors_keep_their_stable_code() {
        let error = CommandError::from(crate::ai::AiError::Unauthorized);
        assert_eq!(error.code(), "ai.unauthorized");
    }

    #[test]
    fn camera_errors_keep_their_stable_code() {
        let error = CommandError::from(crate::camera::CameraError::InvalidPhoto);
        assert_eq!(error.code(), "camera.invalidPhoto");
    }

    #[test]
    fn keep_awake_errors_keep_their_stable_code() {
        let error = CommandError::from(crate::keep_awake::KeepAwakeError::InvalidSchedule);
        assert_eq!(error.code(), "awake.invalidSchedule");
        let error = CommandError::from(crate::keep_awake::KeepAwakeError::System("x".into()));
        assert_eq!(error.code(), "awake.system");
    }

    #[test]
    fn session_errors_keep_their_stable_code() {
        let error = CommandError::from(crate::sessions::SessionError::NotFound);
        assert_eq!(error.code(), "session.notFound");
    }

    #[test]
    fn weather_and_clipboard_errors_keep_their_stable_codes() {
        assert_eq!(
            CommandError::from(WeatherError::Network("x".into())).code(),
            "weather.network"
        );
        assert_eq!(
            CommandError::from(ClipboardError::NotFound).code(),
            "clipboard.notFound"
        );
    }
}
