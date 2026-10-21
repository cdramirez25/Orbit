//! Orquestador del Prompter. Audio del sistema → volumen (Fase 2) y transcripción (Fase 3) →
//! eventos para la isla.
//!
//! Núcleo de la aplicación (§4.0): solo conoce los puertos (`AudioSource`, `SttEngine`,
//! `EventSink`); los adaptadores concretos los elige el composition root (`lib.rs`). Se prueba con
//! fuentes, motores y sumideros simulados, sin dispositivos de audio ni Tauri.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::audio::level::LevelMeter;
use crate::audio::resample::{Normalizer, TARGET_RATE};
use crate::audio::wav::WavWriter;
use crate::audio::{AudioError, AudioFrame, AudioSource};
use crate::events::{DomainEvent, EventSink, OrbitError, PipelineState};
use crate::stt::{transcriber, SttEngine, SttMessage};

/// Cada cuánto audio (en tiempo de audio) se publica el volumen: ≈ 30 veces por segundo.
const METER_INTERVAL_SECS: f64 = 0.033;
/// Si no llega audio durante este tiempo se considera silencio y el volumen baja a 0.
const SILENCE_AFTER: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Default)]
pub struct PipelineConfig {
    /// Si se indica, el audio normalizado (16 kHz mono) se vuelca a este WAV. Solo depuración.
    pub debug_wav: Option<PathBuf>,
}

struct Worker {
    handle: JoinHandle<()>,
    /// Pide al hilo que termine (no es un fallo: el usuario paró).
    stop: Arc<AtomicBool>,
    /// El hilo lo baja al terminar por cualquier motivo.
    running: Arc<AtomicBool>,
    /// Para pedirle a la transcripción que cierre la frase en curso (`flush`).
    transcription: Option<Sender<SttMessage>>,
}

pub struct Pipeline {
    source: Box<dyn AudioSource>,
    events: Arc<dyn EventSink>,
    config: PipelineConfig,
    /// Motor de voz a texto; sin él solo se mide el volumen.
    stt: Option<Arc<dyn SttEngine>>,
    worker: Option<Worker>,
}

impl Pipeline {
    pub fn new(
        source: Box<dyn AudioSource>,
        events: Arc<dyn EventSink>,
        config: PipelineConfig,
    ) -> Self {
        Self {
            source,
            events,
            config,
            stt: None,
            worker: None,
        }
    }

    /// Conecta el motor de transcripción.
    pub fn with_stt(mut self, engine: Arc<dyn SttEngine>) -> Self {
        self.stt = Some(engine);
        self
    }

    /// ¿Está escuchando ahora mismo? (falso si la captura se cortó sola)
    pub fn is_listening(&self) -> bool {
        self.worker
            .as_ref()
            .is_some_and(|worker| worker.running.load(Ordering::SeqCst))
    }

    /// Empieza a escuchar el audio del sistema.
    pub fn start(&mut self) -> Result<(), AudioError> {
        self.reap_finished();
        if self.worker.is_some() {
            return Err(AudioError::AlreadyRunning);
        }

        let receiver = match self.source.start() {
            Ok(receiver) => receiver,
            Err(error) => {
                self.report(&error);
                return Err(error);
            }
        };

        let stop = Arc::new(AtomicBool::new(false));
        let running = Arc::new(AtomicBool::new(true));
        let transcription = self.spawn_transcriber(&stop);
        let control = transcription.clone();
        let spawned = thread::Builder::new().name("orbit-pipeline".into()).spawn({
            let events = Arc::clone(&self.events);
            let debug_wav = self.config.debug_wav.clone();
            let (stop, running) = (Arc::clone(&stop), Arc::clone(&running));
            move || run(receiver, events, stop, running, debug_wav, transcription)
        });

        match spawned {
            Ok(handle) => {
                self.worker = Some(Worker {
                    handle,
                    stop,
                    running,
                    transcription: control,
                });
                self.events
                    .publish(DomainEvent::PipelineState(PipelineState::Listening));
                Ok(())
            }
            Err(error) => {
                let _ = self.source.stop();
                let error = AudioError::Capture(error.to_string());
                self.report(&error);
                Err(error)
            }
        }
    }

    /// Cierra la frase que se esté diciendo y espera (hasta `timeout`) a que su texto final esté
    /// publicado. Sirve para "terminé de hablar": sin esto, la última frase esperaría la pausa de
    /// 0,8 s, y al parar se perdería. No hace nada si no se está escuchando.
    pub fn flush(&self, timeout: Duration) {
        let Some(sender) = self
            .worker
            .as_ref()
            .and_then(|worker| worker.transcription.as_ref())
        else {
            return;
        };
        let (done, wait) = channel();
        if sender.send(SttMessage::Flush(done)).is_ok() {
            // Si el hilo termina antes de contestar, el canal se cierra y la espera acaba sola.
            let _ = wait.recv_timeout(timeout);
        }
    }

    /// Deja de escuchar. Se puede llamar aunque no esté escuchando.
    pub fn stop(&mut self) {
        self.shutdown();
        self.events
            .publish(DomainEvent::PipelineState(PipelineState::Idle));
    }

    fn shutdown(&mut self) {
        if let Some(worker) = self.worker.take() {
            // Primero la bandera: así el hilo no toma el cierre del canal por un fallo.
            worker.stop.store(true, Ordering::SeqCst);
            if let Err(error) = self.source.stop() {
                tracing::warn!(%error, "no se pudo detener la captura de audio");
            }
            if worker.handle.join().is_err() {
                tracing::warn!("el hilo del pipeline terminó con un pánico");
            }
        }
    }

    /// Si el hilo ya terminó (la captura se cortó), lo recoge y libera la fuente.
    fn reap_finished(&mut self) {
        if self
            .worker
            .as_ref()
            .is_some_and(|worker| !worker.running.load(Ordering::SeqCst))
        {
            self.shutdown();
        }
    }

    /// Arranca el hilo de transcripción y devuelve por dónde mandarle el audio. El hilo termina
    /// solo cuando se cierra ese canal; no se espera a que acabe una transcripción en curso.
    fn spawn_transcriber(&self, stop: &Arc<AtomicBool>) -> Option<Sender<SttMessage>> {
        let engine = Arc::clone(self.stt.as_ref()?);
        let (sender, receiver) = channel();
        let events = Arc::clone(&self.events);
        let stop = Arc::clone(stop);
        let spawned = thread::Builder::new()
            .name("orbit-stt".into())
            .spawn(move || transcriber::run(receiver, engine, events, stop));
        match spawned {
            Ok(_) => Some(sender),
            Err(error) => {
                tracing::warn!(%error, "no se pudo iniciar el hilo de transcripción");
                None
            }
        }
    }

    fn report(&self, error: &AudioError) {
        self.events.publish(DomainEvent::Error(OrbitError {
            code: error.code().to_string(),
            message: error.to_string(),
            recoverable: true,
        }));
        self.events
            .publish(DomainEvent::PipelineState(PipelineState::Error));
    }
}

impl Drop for Pipeline {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Bucle del hilo: consume el audio, publica el volumen, se lo pasa a la transcripción y (solo en
/// depuración) vuelca el WAV.
fn run(
    receiver: Receiver<AudioFrame>,
    events: Arc<dyn EventSink>,
    stop: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    debug_wav: Option<PathBuf>,
    mut transcription: Option<Sender<SttMessage>>,
) {
    let mut meter = LevelMeter::new(METER_INTERVAL_SECS);
    // La normalización a 16 kHz mono solo se calcula si hay quien la use: la transcripción o el
    // WAV de depuración.
    let mut normalizer = Normalizer::new();
    let mut wav = debug_wav.and_then(|path| match WavWriter::create(&path, TARGET_RATE) {
        Ok(writer) => {
            tracing::warn!(
                ?path,
                "volcado WAV de depuración ACTIVO: se guarda audio en disco"
            );
            Some(writer)
        }
        Err(error) => {
            tracing::warn!(%error, "no se pudo crear el WAV de depuración");
            None
        }
    });
    let mut source_closed = false;

    while !stop.load(Ordering::SeqCst) {
        match receiver.recv_timeout(SILENCE_AFTER) {
            Ok(frame) => {
                if wav.is_some() || transcription.is_some() {
                    let pcm = normalizer.process(&frame);
                    if let Some(writer) = wav.as_mut() {
                        if let Err(error) = writer.write(&pcm) {
                            tracing::warn!(%error, "se desactiva el WAV de depuración");
                            wav = None;
                        }
                    }
                    if let Some(sender) = &transcription {
                        let samples = pcm.iter().map(|s| f32::from(*s) / 32_768.0).collect();
                        // Sin receptor (el hilo de transcripción terminó) se deja de mandar audio.
                        if sender.send(SttMessage::Audio(samples)).is_err() {
                            transcription = None;
                        }
                    }
                }
                if let Some(level) = meter.push(&frame) {
                    events.publish(DomainEvent::AudioLevel(level));
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if let Some(level) = meter.idle() {
                    events.publish(DomainEvent::AudioLevel(level));
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                source_closed = true;
                break;
            }
        }
    }

    events.publish(DomainEvent::AudioLevel(0.0));
    // El canal se cerró sin que el usuario parara: el sistema cortó la captura (por ejemplo,
    // se desconectó el dispositivo). Es recuperable: basta con volver a empezar.
    if source_closed && !stop.load(Ordering::SeqCst) {
        events.publish(DomainEvent::Error(OrbitError {
            code: "audio.captureEnded".to_string(),
            message: "la captura de audio se detuvo".to_string(),
            recoverable: true,
        }));
        events.publish(DomainEvent::PipelineState(PipelineState::Error));
    }
    running.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::{sync_channel, SyncSender};
    use std::sync::Mutex;
    use std::time::Instant;

    use super::*;
    use crate::events::testing::FakeEventSink;
    use crate::stt::{Pass, SttError, Transcription};

    /// Motor simulado: responde cuántas muestras recibió.
    struct CountingEngine;

    impl SttEngine for CountingEngine {
        fn transcribe(&self, samples: &[f32], _pass: Pass) -> Result<Transcription, SttError> {
            Ok(Transcription {
                text: format!("{} muestras", samples.len()),
            })
        }
    }

    type Slot = Arc<Mutex<Option<SyncSender<AudioFrame>>>>;

    /// Fuente simulada: el test decide qué audio entra (`feed`) y cuándo se corta.
    struct FakeAudioSource {
        slot: Slot,
        fail_with_permission: bool,
        stops: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl AudioSource for FakeAudioSource {
        fn start(&mut self) -> Result<Receiver<AudioFrame>, AudioError> {
            if self.fail_with_permission {
                return Err(AudioError::PermissionDenied);
            }
            let (tx, rx) = sync_channel(64);
            *self.slot.lock().unwrap() = Some(tx);
            Ok(rx)
        }

        fn stop(&mut self) -> Result<(), AudioError> {
            *self.slot.lock().unwrap() = None;
            self.stops.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    struct Harness {
        pipeline: Pipeline,
        events: Arc<FakeEventSink>,
        slot: Slot,
        stops: Arc<std::sync::atomic::AtomicUsize>,
    }

    fn harness(fail_with_permission: bool, config: PipelineConfig) -> Harness {
        let slot: Slot = Arc::default();
        let stops = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let events = Arc::new(FakeEventSink::default());
        let source = FakeAudioSource {
            slot: Arc::clone(&slot),
            fail_with_permission,
            stops: Arc::clone(&stops),
        };
        let pipeline = Pipeline::new(Box::new(source), events.clone(), config);
        Harness {
            pipeline,
            events,
            slot,
            stops,
        }
    }

    /// 48 kHz estéreo, `millis` ms de una señal constante.
    fn frame(value: f32, millis: usize) -> AudioFrame {
        AudioFrame {
            samples: vec![value; 48 * millis * 2],
            sample_rate: 48_000,
            channels: 2,
        }
    }

    fn feed(slot: &Slot, frame: AudioFrame) {
        let guard = slot.lock().unwrap();
        guard
            .as_ref()
            .expect("la captura está en marcha")
            .send(frame)
            .unwrap();
    }

    /// Espera (hasta 3 s) a que se cumpla la condición sobre los eventos publicados.
    fn wait_for(events: &FakeEventSink, condition: impl Fn(&[DomainEvent]) -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if condition(&events.events()) {
                return true;
            }
            thread::sleep(Duration::from_millis(5));
        }
        false
    }

    fn level_above(events: &[DomainEvent], min: f32) -> bool {
        events
            .iter()
            .any(|e| matches!(e, DomainEvent::AudioLevel(l) if *l > min))
    }

    #[test]
    fn starting_publishes_listening_and_then_the_volume() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline.start().unwrap();
        assert!(h.pipeline.is_listening());
        assert_eq!(
            h.events.events().first(),
            Some(&DomainEvent::PipelineState(PipelineState::Listening))
        );

        // 0.1 de amplitud ≈ −20 dB ≈ 0.67 de volumen.
        feed(&h.slot, frame(0.1, 40));
        assert!(wait_for(&h.events, |e| level_above(e, 0.5)));
        h.pipeline.stop();
    }

    #[test]
    fn louder_audio_gives_a_higher_volume() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline.start().unwrap();
        feed(&h.slot, frame(0.5, 40));
        assert!(wait_for(&h.events, |e| level_above(e, 0.8)));
        h.pipeline.stop();
    }

    #[test]
    fn silence_brings_the_volume_back_to_zero() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline.start().unwrap();
        feed(&h.slot, frame(0.3, 40));
        assert!(wait_for(&h.events, |e| level_above(e, 0.5)));

        // Sin más audio, tras la pausa de silencio llega un 0.
        assert!(wait_for(&h.events, |e| {
            let last_loud = e
                .iter()
                .rposition(|x| matches!(x, DomainEvent::AudioLevel(l) if *l > 0.5));
            let last_zero = e
                .iter()
                .rposition(|x| matches!(x, DomainEvent::AudioLevel(l) if *l == 0.0));
            matches!((last_loud, last_zero), (Some(loud), Some(zero)) if zero > loud)
        }));
        h.pipeline.stop();
    }

    #[test]
    fn stopping_publishes_idle_and_releases_the_source() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline.start().unwrap();
        h.pipeline.stop();

        assert!(!h.pipeline.is_listening());
        assert_eq!(h.stops.load(Ordering::SeqCst), 1);
        assert_eq!(
            h.events.events().last(),
            Some(&DomainEvent::PipelineState(PipelineState::Idle))
        );
    }

    #[test]
    fn stopping_when_idle_is_harmless() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline.stop();
        assert!(!h.pipeline.is_listening());
        assert_eq!(h.stops.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_failing_source_reports_an_error_and_does_not_listen() {
        let mut h = harness(true, PipelineConfig::default());
        let result = h.pipeline.start();

        assert!(matches!(result, Err(AudioError::PermissionDenied)));
        assert!(!h.pipeline.is_listening());
        let events = h.events.events();
        assert!(events.iter().any(|e| matches!(
            e,
            DomainEvent::Error(OrbitError { code, recoverable: true, .. })
                if code == "audio.permissionDenied"
        )));
        assert_eq!(
            events.last(),
            Some(&DomainEvent::PipelineState(PipelineState::Error))
        );
    }

    #[test]
    fn a_second_start_is_rejected() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline.start().unwrap();
        assert!(matches!(
            h.pipeline.start(),
            Err(AudioError::AlreadyRunning)
        ));
        h.pipeline.stop();
    }

    #[test]
    fn it_can_listen_again_after_stopping() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline.start().unwrap();
        h.pipeline.stop();
        h.pipeline.start().unwrap();
        assert!(h.pipeline.is_listening());
        feed(&h.slot, frame(0.1, 40));
        assert!(wait_for(&h.events, |e| level_above(e, 0.5)));
        h.pipeline.stop();
    }

    #[test]
    fn a_capture_cut_by_the_system_is_reported_and_recoverable() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline.start().unwrap();

        // El sistema corta la captura: el canal se cierra sin que nadie haya llamado a stop().
        *h.slot.lock().unwrap() = None;

        assert!(wait_for(&h.events, |e| e.iter().any(|x| matches!(
            x,
            DomainEvent::Error(OrbitError { code, recoverable: true, .. })
                if code == "audio.captureEnded"
        ))));
        assert!(wait_for(&h.events, |e| e.last()
            == Some(&DomainEvent::PipelineState(PipelineState::Error))));
        assert!(!h.pipeline.is_listening());

        // Y se puede volver a empezar.
        h.pipeline.start().unwrap();
        assert!(h.pipeline.is_listening());
        h.pipeline.stop();
    }

    #[test]
    fn spoken_audio_is_transcribed_at_16_khz_mono_when_an_engine_is_connected() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline = h.pipeline.with_stt(Arc::new(CountingEngine));
        h.pipeline.start().unwrap();

        // 0.5 s de sonido y 1 s de silencio (cierra la frase), en 48 kHz estéreo.
        feed(&h.slot, frame(0.3, 500));
        feed(&h.slot, frame(0.0, 1000));
        assert!(wait_for(&h.events, |e| e
            .iter()
            .any(|x| matches!(x, DomainEvent::SttFinal { .. }))));
        h.pipeline.stop();

        let text = h
            .events
            .events()
            .into_iter()
            .find_map(|e| match e {
                DomainEvent::SttFinal { text, .. } => Some(text),
                _ => None,
            })
            .unwrap();
        // 0.5 s de voz + 0.2 s de cola, a 16 kHz mono ≈ 11 200 muestras.
        let samples: usize = text.split(' ').next().unwrap().parse().unwrap();
        assert!((10_000..=12_500).contains(&samples), "{samples} muestras");
    }

    #[test]
    fn flushing_publishes_the_phrase_in_progress_without_waiting_for_a_pause() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline = h.pipeline.with_stt(Arc::new(CountingEngine));
        h.pipeline.start().unwrap();

        // Medio segundo de voz y nada más: sin `flush` no saldría ningún final.
        feed(&h.slot, frame(0.3, 500));
        assert!(wait_for(&h.events, |e| level_above(e, 0.5)));
        h.pipeline.flush(Duration::from_secs(3));

        let finals = h
            .events
            .events()
            .into_iter()
            .filter(|e| matches!(e, DomainEvent::SttFinal { .. }))
            .count();
        assert_eq!(finals, 1);
        h.pipeline.stop();
    }

    #[test]
    fn flushing_when_not_listening_does_nothing() {
        let h = harness(false, PipelineConfig::default());
        h.pipeline.flush(Duration::from_millis(50));
        assert!(h.events.events().is_empty());
    }

    #[test]
    fn without_an_engine_there_is_no_transcription() {
        let mut h = harness(false, PipelineConfig::default());
        h.pipeline.start().unwrap();
        feed(&h.slot, frame(0.3, 500));
        feed(&h.slot, frame(0.0, 1000));
        assert!(wait_for(&h.events, |e| level_above(e, 0.5)));
        h.pipeline.stop();

        assert!(!h.events.events().iter().any(|e| matches!(
            e,
            DomainEvent::SttPartial { .. } | DomainEvent::SttFinal { .. }
        )));
    }

    #[test]
    fn the_volume_keeps_flowing_while_the_engine_is_slow() {
        struct SlowEngine;
        impl SttEngine for SlowEngine {
            fn transcribe(&self, _samples: &[f32], _pass: Pass) -> Result<Transcription, SttError> {
                thread::sleep(Duration::from_millis(1500));
                Ok(Transcription {
                    text: "lento".into(),
                })
            }
        }

        let mut h = harness(false, PipelineConfig::default());
        h.pipeline = h.pipeline.with_stt(Arc::new(SlowEngine));
        h.pipeline.start().unwrap();
        // Una frase suave (volumen < 0.8) y una pausa: el motor se pone a "trabajar" 1.5 s.
        feed(&h.slot, frame(0.1, 500));
        feed(&h.slot, frame(0.0, 1000));
        // Mientras tanto llega un sonido fuerte y el volumen sube sin esperar al motor.
        feed(&h.slot, frame(0.5, 40));
        assert!(wait_for(&h.events, |e| level_above(e, 0.8)));
        assert!(!h
            .events
            .events()
            .iter()
            .any(|e| matches!(e, DomainEvent::SttFinal { .. })));
        h.pipeline.stop();
    }

    #[test]
    fn the_debug_wav_receives_normalized_audio_only_when_enabled() {
        let path = std::env::temp_dir().join(format!("orbit-pipeline-{}.wav", std::process::id()));
        let config = PipelineConfig {
            debug_wav: Some(path.clone()),
        };
        let mut h = harness(false, config);
        h.pipeline.start().unwrap();
        feed(&h.slot, frame(0.5, 100)); // 100 ms → 1600 muestras a 16 kHz
        assert!(wait_for(&h.events, |e| level_above(e, 0.8)));
        h.pipeline.stop();

        let bytes = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        let data_len = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
        assert!(
            (i64::from(data_len) - 3200).abs() <= 4,
            "datos: {data_len} B"
        );
        // 0.5 de amplitud → 16384 en PCM16.
        let first = i16::from_le_bytes([bytes[44], bytes[45]]);
        assert!((first - 16_384).abs() <= 1);
    }
}
