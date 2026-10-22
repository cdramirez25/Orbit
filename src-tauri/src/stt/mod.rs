//! Transcripción (Fase 3): del audio normalizado (16 kHz mono) al texto de lo que se dice.
//!
//! Núcleo (§4.0): aquí viven el puerto `SttEngine` y la lógica que no depende del motor
//! (`segmenter`: dónde empieza y acaba una frase; `transcriber`: el hilo que pide el texto y lo
//! publica). El motor concreto (`whisper_local`) lo elige el composition root (`lib.rs`).
//!
//! Los motores de Whisper no transcriben en streaming: cada llamada recibe un trozo de audio
//! completo. El "en vivo" se consigue repitiendo la llamada sobre la frase en curso (parciales) y
//! cerrándola cuando hay una pausa (final).

pub mod model;
pub mod model_source;
pub mod segmenter;
pub mod transcriber;
pub mod whisper_local;

use std::path::PathBuf;
use std::sync::mpsc::Sender;

use serde::{Deserialize, Serialize};

/// Idioma en el que se transcribe: que el motor lo detecte solo o uno fijo (si se sabe cuál es,
/// acierta más y tarda menos, y no confunde un acento con otro idioma).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SttLanguage {
    #[default]
    Auto,
    Es,
    En,
}

impl SttLanguage {
    /// Código que entiende Whisper (`auto` = detectarlo en cada frase).
    pub fn code(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Es => "es",
            Self::En => "en",
        }
    }
}

/// Lo que le llega al hilo de transcripción.
pub enum SttMessage {
    /// Audio normalizado (16 kHz, mono).
    Audio(Vec<f32>),
    /// Quien habla terminó: cerrar la frase en curso, publicar su texto final y avisar por el canal.
    Flush(Sender<()>),
}

/// Lo que devuelve un motor para un trozo de audio.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transcription {
    /// Texto reconocido (puede venir vacío si no había voz).
    pub text: String,
}

/// Para qué se pide la transcripción: un borrador rápido mientras la frase sigue, o el texto
/// definitivo cuando termina (donde importa más acertar que ir deprisa).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pass {
    Partial,
    Final,
}

/// Puerto: un motor de voz a texto.
///
/// Es síncrono y bloqueante (puede tardar cientos de milisegundos): el `transcriber` lo llama
/// desde su propio hilo, nunca desde el del volumen. `&self` con estado interno protegido para
/// poder compartirlo entre una escucha y la siguiente sin recargar el modelo.
pub trait SttEngine: Send + Sync {
    /// Transcribe `samples` (16 kHz, mono, `f32` entre −1 y 1).
    fn transcribe(&self, samples: &[f32], pass: Pass) -> Result<Transcription, SttError>;

    /// Carga lo que haga falta (por ejemplo el modelo) para que la primera frase no espere.
    fn warm_up(&self) -> Result<(), SttError> {
        Ok(())
    }

    /// Libera la memoria del motor (al dejar de escuchar). La siguiente llamada vuelve a cargarlo.
    fn release(&self) {}

    /// Cambia el idioma de las próximas transcripciones.
    fn set_language(&self, _language: SttLanguage) {}
}

#[derive(Debug, thiserror::Error)]
pub enum SttError {
    #[error("falta el modelo de transcripción en {0}")]
    ModelMissing(PathBuf),
    #[error("no se pudo cargar el modelo de transcripción: {0}")]
    ModelLoad(String),
    #[error("falló la transcripción: {0}")]
    Inference(String),
}

impl SttError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::ModelMissing(_) => "stt.modelMissing",
            Self::ModelLoad(_) => "stt.modelLoad",
            Self::Inference(_) => "stt.inference",
        }
    }

    /// ¿Reintentar con el siguiente trozo tiene sentido? Si el modelo no está o no carga, no.
    pub fn is_permanent(&self) -> bool {
        matches!(self, Self::ModelMissing(_) | Self::ModelLoad(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(
            SttError::ModelMissing(PathBuf::from("x")).code(),
            "stt.modelMissing"
        );
        assert_eq!(SttError::ModelLoad("x".into()).code(), "stt.modelLoad");
        assert_eq!(SttError::Inference("x".into()).code(), "stt.inference");
    }

    #[test]
    fn languages_map_to_whisper_codes_and_the_wire_format() {
        assert_eq!(SttLanguage::default(), SttLanguage::Auto);
        assert_eq!(SttLanguage::Auto.code(), "auto");
        assert_eq!(SttLanguage::Es.code(), "es");
        assert_eq!(SttLanguage::En.code(), "en");
        assert_eq!(serde_json::to_value(SttLanguage::Es).unwrap(), "es");
        assert_eq!(
            serde_json::from_str::<SttLanguage>("\"auto\"").unwrap(),
            SttLanguage::Auto
        );
    }

    #[test]
    fn only_model_problems_are_permanent() {
        assert!(SttError::ModelMissing(PathBuf::from("x")).is_permanent());
        assert!(SttError::ModelLoad("x".into()).is_permanent());
        assert!(!SttError::Inference("x".into()).is_permanent());
    }
}
