//! Windows: el audio de salida se captura con WASAPI en modo loopback del dispositivo
//! predeterminado. No pide ningún permiso al usuario ni muestra avisos. Verificar a mano en
//! Windows 10 2004+ / 11.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

use crate::audio::format::bytes_to_f32;
use crate::audio::permission::AudioPermission;
use crate::audio::{AudioError, AudioFrame, AudioSource};

/// Formato que se pide a Windows (convierte él mismo si el dispositivo usa otro).
const SAMPLE_RATE: usize = 48_000;
const CHANNELS: usize = 2;
/// Trozos de audio que pueden esperar a ser consumidos antes de descartar.
const CHANNEL_DEPTH: usize = 256;
/// Con el sistema en silencio el evento no se dispara: esperar es normal, no es un error.
const WAIT_MS: u32 = 100;

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

fn capture_error(error: impl std::fmt::Display) -> AudioError {
    AudioError::Capture(error.to_string())
}

struct Worker {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

/// Captura del audio de salida del sistema (nunca el micrófono) con WASAPI loopback.
pub struct SystemAudioSource {
    worker: Option<Worker>,
}

impl SystemAudioSource {
    pub fn new() -> Self {
        Self { worker: None }
    }
}

impl Default for SystemAudioSource {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioSource for SystemAudioSource {
    fn start(&mut self) -> Result<Receiver<AudioFrame>, AudioError> {
        if self.worker.is_some() {
            return Err(AudioError::AlreadyRunning);
        }

        let (sender, receiver) = mpsc::sync_channel(CHANNEL_DEPTH);
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), AudioError>>(1);
        let stop = Arc::new(AtomicBool::new(false));

        // WASAPI vive en su propio hilo (COM se inicializa en él). `ready` avisa de si arrancó.
        let handle = thread::Builder::new()
            .name("orbit-audio-capture".into())
            .spawn({
                let stop = Arc::clone(&stop);
                move || capture_loop(&sender, &ready_tx, &stop)
            })
            .map_err(capture_error)?;

        match ready_rx.recv() {
            Ok(Ok(())) => {
                self.worker = Some(Worker { stop, handle });
                Ok(receiver)
            }
            Ok(Err(error)) => {
                let _ = handle.join();
                Err(error)
            }
            Err(_) => {
                let _ = handle.join();
                Err(AudioError::Capture(
                    "el hilo de captura terminó sin responder".to_string(),
                ))
            }
        }
    }

    fn stop(&mut self) -> Result<(), AudioError> {
        if let Some(worker) = self.worker.take() {
            worker.stop.store(true, Ordering::SeqCst);
            if worker.handle.join().is_err() {
                return Err(AudioError::Capture(
                    "el hilo de captura terminó con un pánico".to_string(),
                ));
            }
        }
        Ok(())
    }
}

fn capture_loop(
    sender: &SyncSender<AudioFrame>,
    ready: &SyncSender<Result<(), AudioError>>,
    stop: &AtomicBool,
) {
    // Todo el montaje en un cierre para poder avisar de un fallo sin duplicar el aviso.
    let setup = (|| -> Result<_, AudioError> {
        wasapi::initialize_mta().ok().map_err(capture_error)?;
        let enumerator = DeviceEnumerator::new().map_err(capture_error)?;
        // El dispositivo de SALIDA predeterminado: pedirle "capturar" a un dispositivo de
        // salida activa el loopback.
        let device = enumerator
            .get_default_device(&Direction::Render)
            .map_err(|_| AudioError::NoOutputDevice)?;
        let mut client = device.get_iaudioclient().map_err(capture_error)?;
        let format = WaveFormat::new(32, 32, &SampleType::Float, SAMPLE_RATE, CHANNELS, None);
        let (_default_period, min_period) = client.get_device_period().map_err(capture_error)?;
        client
            .initialize_client(
                &format,
                &Direction::Capture,
                &StreamMode::EventsShared {
                    autoconvert: true,
                    buffer_duration_hns: min_period,
                },
            )
            .map_err(capture_error)?;
        let event = client.set_get_eventhandle().map_err(capture_error)?;
        let capture = client.get_audiocaptureclient().map_err(capture_error)?;
        client.start_stream().map_err(capture_error)?;
        Ok((client, event, capture))
    })();

    let (client, event, capture) = match setup {
        Ok(parts) => {
            let _ = ready.send(Ok(()));
            parts
        }
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };

    let mut queue: VecDeque<u8> = VecDeque::new();
    while !stop.load(Ordering::SeqCst) {
        // Con el sistema en silencio la espera vence por tiempo; se lee igualmente.
        let _ = event.wait_for_event(WAIT_MS);
        if let Err(error) = capture.read_from_device_to_deque(&mut queue) {
            tracing::warn!(%error, "se perdió el dispositivo de audio de salida");
            break;
        }
        if queue.is_empty() {
            continue;
        }

        let bytes: Vec<u8> = queue.drain(..).collect();
        let frame = AudioFrame {
            samples: bytes_to_f32(&bytes),
            sample_rate: SAMPLE_RATE as u32,
            channels: CHANNELS as u16,
        };
        match sender.try_send(frame) {
            Ok(()) => {}
            // Nunca se bloquea la captura: si el consumidor va lento, se descarta.
            Err(TrySendError::Full(_)) => tracing::debug!("audio descartado: consumidor retrasado"),
            Err(TrySendError::Disconnected(_)) => break,
        }
    }
    if let Err(error) = client.stop_stream() {
        tracing::debug!(%error, "no se pudo detener el stream de WASAPI");
    }
}
