//! Comandos de Tauri (adaptadores de entrada): finos, validan, llaman al núcleo y devuelven.
//! Sin lógica de negocio.

pub mod audio;
pub mod island;

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("error de ventana: {0}")]
    Window(#[from] tauri::Error),
    #[error("error de audio: {0}")]
    Audio(#[from] crate::audio::AudioError),
}

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
