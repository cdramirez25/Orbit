//! macOS: el audio del sistema se captura con ScreenCaptureKit, que exige el permiso de
//! "Grabación de pantalla". (La alternativa, los process taps de Core Audio, pide otro permiso
//! distinto y solo existe desde macOS 14.2; se valorará más adelante.)
//!
//! OJO en desarrollo: con `pnpm tauri dev` el binario cuelga de la terminal (o de la app que la
//! lanza), y macOS atribuye el permiso a ESA app, no a "orbit". Hay que concederlo a la terminal.

use std::io;
use std::process::Command;
use std::sync::mpsc::{self, Receiver, TrySendError};

use screencapturekit::prelude::*;

use crate::audio::format::{bytes_to_f32, interleave_planar};
use crate::audio::permission::AudioPermission;
use crate::audio::{AudioError, AudioFrame, AudioSource};

/// Frecuencia y canales que se piden a ScreenCaptureKit (él hace la conversión).
const SAMPLE_RATE: i32 = 48_000;
const CHANNELS: i32 = 2;
/// Trozos de audio (≈ 10 ms cada uno) que pueden esperar a ser consumidos antes de descartar.
const CHANNEL_DEPTH: usize = 256;

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

fn capture_error(error: impl std::fmt::Display) -> AudioError {
    AudioError::Capture(error.to_string())
}

/// Captura del audio de salida del sistema (nunca el micrófono) con ScreenCaptureKit.
pub struct SystemAudioSource {
    stream: Option<SCStream>,
}

impl SystemAudioSource {
    pub fn new() -> Self {
        Self { stream: None }
    }
}

impl Default for SystemAudioSource {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioSource for SystemAudioSource {
    fn start(&mut self) -> Result<Receiver<AudioFrame>, AudioError> {
        if self.stream.is_some() {
            return Err(AudioError::AlreadyRunning);
        }
        if !SystemAudioPermission.is_granted() {
            return Err(AudioError::PermissionDenied);
        }

        // ScreenCaptureKit pide una pantalla aunque solo queramos el audio.
        let content = SCShareableContent::get().map_err(capture_error)?;
        let display = content
            .displays()
            .into_iter()
            .next()
            .ok_or(AudioError::NoOutputDevice)?;
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build()
            .map_err(capture_error)?;

        // Vídeo mínimo (2×2) porque el stream lo exige; solo se registra el manejador de audio.
        let config = SCStreamConfiguration::new()
            .with_width(2)
            .with_height(2)
            .with_captures_audio(true)
            .with_sample_rate(SAMPLE_RATE)
            .with_channel_count(CHANNELS)
            .with_excludes_current_process_audio(true);

        let (sender, receiver) = mpsc::sync_channel(CHANNEL_DEPTH);
        let mut stream = SCStream::new(&filter, &config).map_err(capture_error)?;
        stream
            .add_output_handler(
                move |sample: CMSampleBuffer, kind: SCStreamOutputType| {
                    if kind != SCStreamOutputType::Audio {
                        return;
                    }
                    let Some(frame) = frame_from(&sample) else {
                        return;
                    };
                    // Nunca se bloquea el hilo de captura: si el consumidor va lento, se descarta.
                    if let Err(TrySendError::Full(_)) = sender.try_send(frame) {
                        tracing::debug!("audio descartado: el consumidor va retrasado");
                    }
                },
                SCStreamOutputType::Audio,
            )
            .map_err(capture_error)?;
        stream.start_capture().map_err(capture_error)?;

        self.stream = Some(stream);
        Ok(receiver)
    }

    fn stop(&mut self) -> Result<(), AudioError> {
        if let Some(stream) = self.stream.take() {
            stream.stop_capture().map_err(capture_error)?;
        }
        Ok(())
    }
}

/// `CMSampleBuffer` de audio → `AudioFrame` (muestras `f32` entrelazadas). ScreenCaptureKit
/// entrega `Float32`, normalmente con un plano por canal.
fn frame_from(sample: &CMSampleBuffer) -> Option<AudioFrame> {
    let format = sample.format_description()?;
    let sample_rate = format.audio_sample_rate()?;
    let channels = u16::try_from(format.audio_channel_count()?).ok()?;
    if channels == 0 || !format.audio_is_float() || format.audio_bits_per_channel()? != 32 {
        return None;
    }

    let list = sample.audio_buffer_list().ok()?;
    let planes: Vec<Vec<f32>> = list
        .iter()
        .map(|buffer| bytes_to_f32(buffer.data()))
        .collect();
    let samples = if channels > 1 && planes.len() == usize::from(channels) {
        let refs: Vec<&[f32]> = planes.iter().map(Vec::as_slice).collect();
        interleave_planar(&refs)
    } else {
        planes.concat() // ya viene entrelazado (o es mono)
    };

    Some(AudioFrame {
        samples,
        sample_rate: sample_rate.round() as u32,
        channels,
    })
}
