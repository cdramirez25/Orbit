//! Audio del sistema: lo que suena por bocinas y audífonos (nunca el micrófono). Aquí viven los
//! puertos y los tipos de dominio; las implementaciones por sistema operativo, en `platform/`.
//!
//! Flujo (Fase 2): `AudioSource` (adaptador del SO) → `AudioFrame` en formato nativo →
//! `resample::Normalizer` (16 kHz mono PCM16, para el STT de la Fase 3) y `level::LevelMeter`
//! (volumen para las ondas de la isla). El orquestador es `pipeline::Pipeline`.

pub mod format;
pub mod level;
pub mod permission;
pub mod platform;
pub mod resample;
pub mod wav;

use std::sync::mpsc::Receiver;

/// Un trozo de audio tal como lo entrega el sistema: muestras `f32` **entrelazadas**
/// (L R L R…), con su frecuencia y su número de canales.
#[derive(Debug, Clone, PartialEq)]
pub struct AudioFrame {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}

impl AudioFrame {
    /// Cuántas muestras por canal contiene.
    pub fn frame_count(&self) -> usize {
        match usize::from(self.channels) {
            0 => 0,
            channels => self.samples.len() / channels,
        }
    }

    /// Duración del trozo, en segundos.
    pub fn duration_secs(&self) -> f64 {
        if self.sample_rate == 0 {
            0.0
        } else {
            self.frame_count() as f64 / f64::from(self.sample_rate)
        }
    }
}

/// Puerto: de dónde sale el audio. Solo el de **salida** del sistema, nunca el micrófono.
///
/// Es síncrono y con un canal estándar para poder usarlo como `Box<dyn AudioSource>`; la
/// Fase 3 lo adapta al STT asíncrono.
pub trait AudioSource: Send {
    /// Empieza a capturar y devuelve el canal por el que llegan los trozos de audio. El canal se
    /// cierra cuando la captura termina (por `stop` o porque el sistema la cortó).
    fn start(&mut self) -> Result<Receiver<AudioFrame>, AudioError>;
    /// Detiene la captura y libera los recursos del sistema.
    fn stop(&mut self) -> Result<(), AudioError>;
}

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("no se pudieron abrir los ajustes del sistema: {0}")]
    OpenSettings(#[from] std::io::Error),
    #[error("falta el permiso para capturar el audio del sistema")]
    PermissionDenied,
    #[error("no hay un dispositivo de salida de audio disponible")]
    NoOutputDevice,
    #[error("ya se está capturando el audio")]
    AlreadyRunning,
    #[error("error de captura de audio: {0}")]
    Capture(String),
}

impl AudioError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::OpenSettings(_) => "audio.openSettings",
            Self::PermissionDenied => "audio.permissionDenied",
            Self::NoOutputDevice => "audio.noOutputDevice",
            Self::AlreadyRunning => "audio.alreadyRunning",
            Self::Capture(_) => "audio.capture",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_count_and_duration_follow_channels_and_rate() {
        let frame = AudioFrame {
            samples: vec![0.0; 960], // 480 muestras por canal
            sample_rate: 48_000,
            channels: 2,
        };
        assert_eq!(frame.frame_count(), 480);
        assert!((frame.duration_secs() - 0.01).abs() < 1e-9);
    }

    #[test]
    fn degenerate_frames_do_not_divide_by_zero() {
        let no_channels = AudioFrame {
            samples: vec![0.0; 10],
            sample_rate: 48_000,
            channels: 0,
        };
        assert_eq!(no_channels.frame_count(), 0);
        let no_rate = AudioFrame {
            samples: vec![0.0; 10],
            sample_rate: 0,
            channels: 2,
        };
        assert_eq!(no_rate.duration_secs(), 0.0);
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(
            AudioError::PermissionDenied.code(),
            "audio.permissionDenied"
        );
        assert_eq!(AudioError::NoOutputDevice.code(), "audio.noOutputDevice");
        assert_eq!(AudioError::AlreadyRunning.code(), "audio.alreadyRunning");
        assert_eq!(AudioError::Capture("x".into()).code(), "audio.capture");
    }
}
