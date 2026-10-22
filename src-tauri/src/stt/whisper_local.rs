//! Motor de transcripción local con `whisper-rs` (whisper.cpp enlazado dentro de la app). No usa
//! red ni claves: el audio nunca sale de la máquina. En macOS corre en la GPU con Metal.

use std::sync::{Arc, Mutex, MutexGuard, Once, PoisonError};
use std::time::Instant;

use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

use super::location::ModelLocation;
use super::{Pass, SttEngine, SttError, SttLanguage, Transcription};

/// Modelo por defecto: `small` multilingüe (≈ 465 MB), buen equilibrio entre precisión y velocidad.
pub const MODEL_FILE: &str = "ggml-small.bin";

/// Un segmento con más probabilidad que esta de ser "no voz" se descarta (música, ruido).
const MAX_NO_SPEECH: f32 = 0.8;

/// Whisper procesa siempre 30 s de audio (1500 posiciones, una cada 20 ms) aunque la frase dure 3.
/// En los borradores se limita a lo que dura el audio más un margen: ≈ 3 veces más rápido. El
/// texto definitivo usa el contexto completo, que acierta algo más.
const SAMPLES_PER_POSITION: usize = 320;
const AUDIO_CTX_MARGIN: usize = 100;
const AUDIO_CTX_MAX: usize = 1500;

static LOGGING: Once = Once::new();

/// El modelo se carga al empezar a escuchar y se suelta al parar (`release`): son cientos de MB
/// que no deben ocupar memoria con la isla en reposo.
pub struct WhisperEngine {
    location: Arc<ModelLocation>,
    state: Mutex<Option<WhisperState>>,
    language: Mutex<SttLanguage>,
}

impl WhisperEngine {
    pub fn new(location: Arc<ModelLocation>) -> Self {
        Self {
            location,
            state: Mutex::new(None),
            language: Mutex::new(SttLanguage::default()),
        }
    }

    fn language(&self) -> SttLanguage {
        *self.language.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Lee el modelo una vez para que el sistema lo deje en su caché de disco: tras encender el
    /// equipo tarda varios segundos en leerse y así la primera escucha no tiene que esperar.
    pub fn prime_disk_cache(&self) {
        if let Ok(mut file) = std::fs::File::open(self.location.path()) {
            let _ = std::io::copy(&mut file, &mut std::io::sink());
        }
    }

    fn lock(&self) -> MutexGuard<'_, Option<WhisperState>> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn load(&self) -> Result<WhisperState, SttError> {
        let model_path = self.location.path();
        if !model_path.is_file() {
            return Err(SttError::ModelMissing(model_path));
        }
        // whisper.cpp escribe mucho en la salida estándar: se silencia (no se enlaza a `tracing`).
        LOGGING.call_once(whisper_rs::install_logging_hooks);

        let started = Instant::now();
        let context =
            WhisperContext::new_with_params(&model_path, WhisperContextParameters::default())
                .map_err(|error| SttError::ModelLoad(error.to_string()))?;
        let state = context
            .create_state()
            .map_err(|error| SttError::ModelLoad(error.to_string()))?;
        tracing::info!(
            took_ms = started.elapsed().as_millis() as u64,
            "modelo de transcripción cargado"
        );
        Ok(state)
    }
}

impl SttEngine for WhisperEngine {
    fn transcribe(&self, samples: &[f32], pass: Pass) -> Result<Transcription, SttError> {
        let mut guard = self.lock();
        if guard.is_none() {
            *guard = Some(self.load()?);
        }
        let Some(state) = guard.as_mut() else {
            return Err(SttError::Inference("el modelo no está cargado".into()));
        };

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(threads());
        // Con `auto` el idioma se detecta en cada frase: la misma conversación puede mezclarlos.
        params.set_language(Some(self.language().code()));
        params.set_translate(false);
        // Cada llamada es independiente: nada del texto anterior condiciona a la siguiente.
        params.set_no_context(true);
        params.set_single_segment(true);
        params.set_no_timestamps(true);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        // Sin reintentos con temperatura: son más lentos y solo ayudan con audio muy malo.
        params.set_temperature(0.0);
        params.set_temperature_inc(0.0);
        params.set_no_speech_thold(0.6);
        if pass == Pass::Partial {
            params.set_audio_ctx(audio_ctx(samples.len()));
        }
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);

        state
            .full(params, samples)
            .map_err(|error| SttError::Inference(error.to_string()))?;

        let mut text = String::new();
        for segment in state.as_iter() {
            if segment.no_speech_probability() > MAX_NO_SPEECH {
                continue;
            }
            let piece = segment
                .to_str_lossy()
                .map_err(|error| SttError::Inference(error.to_string()))?;
            text.push_str(&piece);
        }
        Ok(Transcription {
            text: text.trim().to_string(),
        })
    }

    fn warm_up(&self) -> Result<(), SttError> {
        let mut guard = self.lock();
        if guard.is_none() {
            *guard = Some(self.load()?);
        }
        Ok(())
    }

    fn release(&self) {
        *self.lock() = None;
    }

    fn set_language(&self, language: SttLanguage) {
        *self.language.lock().unwrap_or_else(PoisonError::into_inner) = language;
    }
}

fn audio_ctx(samples: usize) -> i32 {
    let positions = (samples / SAMPLES_PER_POSITION + AUDIO_CTX_MARGIN).min(AUDIO_CTX_MAX);
    i32::try_from(positions).unwrap_or(1500)
}

/// Hilos de CPU para whisper.cpp: la mitad de los núcleos, entre 2 y 8, para dejar sitio al resto
/// del sistema (en Mac la mayor parte del trabajo va a la GPU).
fn threads() -> i32 {
    let cores = std::thread::available_parallelism().map_or(4, std::num::NonZero::get);
    i32::try_from((cores / 2).clamp(2, 8)).unwrap_or(4)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::events::{DomainEvent, EventSink};

    #[test]
    fn a_missing_model_is_reported_with_its_path() {
        let path = std::env::temp_dir().join("orbit-no-such-model.bin");
        let engine = WhisperEngine::new(Arc::new(ModelLocation::fixed(path.clone())));

        let result = engine.transcribe(&[0.0; 16_000], Pass::Final);
        assert!(matches!(result, Err(SttError::ModelMissing(p)) if p == path));
        assert!(matches!(engine.warm_up(), Err(SttError::ModelMissing(_))));
    }

    #[test]
    fn releasing_an_engine_that_never_loaded_is_harmless() {
        WhisperEngine::new(Arc::new(ModelLocation::fixed(PathBuf::from("x.bin")))).release();
    }

    #[test]
    fn the_language_can_be_changed_and_starts_automatic() {
        let engine = WhisperEngine::new(Arc::new(ModelLocation::fixed(PathBuf::from("x.bin"))));
        assert_eq!(engine.language(), SttLanguage::Auto);
        engine.set_language(SttLanguage::Es);
        assert_eq!(engine.language().code(), "es");
    }

    #[test]
    fn the_audio_context_follows_the_length_with_a_margin_and_a_cap() {
        assert_eq!(audio_ctx(16_000), 150); // 1 s = 50 posiciones + 100 de margen
        assert_eq!(audio_ctx(16_000 * 5), 350);
        assert_eq!(audio_ctx(16_000 * 60), 1500); // nunca más de 30 s
    }

    #[test]
    fn the_thread_count_is_in_range() {
        assert!((2..=8).contains(&threads()));
    }

    /// Lee un WAV PCM de 16 bits mono (el que genera `say --file-format=WAVE --data-format=LEI16@16000`).
    fn read_wav(path: &std::path::Path) -> Vec<f32> {
        let bytes = std::fs::read(path).expect("no se pudo leer el WAV");
        let mut at = 12;
        while at + 8 <= bytes.len() {
            let size =
                u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]])
                    as usize;
            if &bytes[at..at + 4] == b"data" {
                let end = (at + 8 + size).min(bytes.len());
                return bytes[at + 8..end]
                    .chunks_exact(2)
                    .map(|b| f32::from(i16::from_le_bytes([b[0], b[1]])) / 32768.0)
                    .collect();
            }
            at += 8 + size;
        }
        panic!("el WAV no tiene bloque de datos");
    }

    /// Prueba con el modelo real. Manual: necesita el modelo descargado y un WAV con voz.
    ///
    /// ```text
    /// say -v Eddy -o /tmp/orbit-test.wav --file-format=WAVE --data-format=LEI16@16000 "Hola mundo"
    /// ORBIT_TEST_WAV=/tmp/orbit-test.wav cargo test live_transcription -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "necesita el modelo descargado y un WAV de voz en ORBIT_TEST_WAV"]
    fn live_transcription() {
        let wav = std::env::var("ORBIT_TEST_WAV").expect("falta ORBIT_TEST_WAV");
        let model = std::env::var("ORBIT_TEST_MODEL").map_or_else(
            |_| {
                PathBuf::from(std::env::var("HOME").expect("falta HOME"))
                    .join("Library/Application Support/dev.orbit.island/models")
                    .join(MODEL_FILE)
            },
            PathBuf::from,
        );
        let samples = read_wav(std::path::Path::new(&wav));
        let engine = WhisperEngine::new(Arc::new(ModelLocation::fixed(model)));

        let load = Instant::now();
        engine.warm_up().expect("no cargó el modelo");
        println!("carga: {} ms", load.elapsed().as_millis());

        for _ in 0..2 {
            let started = Instant::now();
            let result = engine
                .transcribe(&samples, Pass::Final)
                .expect("falló la transcripción");
            println!(
                "audio: {:.1} s  ->  {} ms  ->  {:?}",
                samples.len() as f32 / 16_000.0,
                started.elapsed().as_millis(),
                result.text
            );
            assert!(!result.text.is_empty());
        }
        engine.release();
    }

    /// Sumidero que apunta cuándo llega cada texto.
    struct TimedSink {
        start: Instant,
        lines: Mutex<Vec<(u128, &'static str, String)>>,
    }

    impl EventSink for TimedSink {
        fn publish(&self, event: DomainEvent) {
            let (kind, text) = match event {
                DomainEvent::SttPartial { text } => ("parcial", text),
                DomainEvent::SttFinal { text, .. } => ("final  ", text),
                _ => return,
            };
            let at = self.start.elapsed().as_millis();
            if let Ok(mut lines) = self.lines.lock() {
                lines.push((at, kind, text));
            }
        }
    }

    /// Prueba con el modelo real y el flujo completo (segmentación + hilo + motor): manda el WAV en
    /// tiempo real, en trozos de 100 ms, y muestra cuándo llega cada parcial y cada final.
    ///
    /// ```text
    /// ORBIT_TEST_WAV=/tmp/orbit-test.wav cargo test live_streaming -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "necesita el modelo descargado y un WAV de voz en ORBIT_TEST_WAV"]
    fn live_streaming() {
        use std::sync::atomic::AtomicBool;
        use std::sync::mpsc::channel;
        use std::time::Duration;

        use crate::stt::transcriber;

        let wav = std::env::var("ORBIT_TEST_WAV").expect("falta ORBIT_TEST_WAV");
        let model = PathBuf::from(std::env::var("HOME").expect("falta HOME"))
            .join("Library/Application Support/dev.orbit.island/models")
            .join(MODEL_FILE);
        let mut samples = read_wav(std::path::Path::new(&wav));
        samples.extend(vec![0.0; 16_000 * 2]); // 2 s de silencio al final cierran la frase

        let sink = Arc::new(TimedSink {
            start: Instant::now(),
            lines: Mutex::new(Vec::new()),
        });
        let engine: Arc<dyn SttEngine> =
            Arc::new(WhisperEngine::new(Arc::new(ModelLocation::fixed(model))));
        let (tx, rx) = channel();
        let handle = std::thread::spawn({
            let sink = Arc::clone(&sink);
            move || transcriber::run(rx, engine, sink, Arc::new(AtomicBool::new(false)))
        });

        // El modelo se carga primero (como al empezar a escuchar de verdad).
        std::thread::sleep(Duration::from_secs(2));
        let audio_start = Instant::now();
        for chunk in samples.chunks(1_600) {
            tx.send(crate::stt::SttMessage::Audio(chunk.to_vec()))
                .expect("el transcriptor sigue vivo");
            std::thread::sleep(Duration::from_millis(100));
        }
        drop(tx);
        handle.join().expect("el hilo terminó bien");

        let lines = sink.lines.lock().expect("sin pánico");
        let offset = audio_start.duration_since(sink.start).as_millis();
        for (at, kind, text) in lines.iter() {
            println!("{:>6} ms  {kind}  {text:?}", at.saturating_sub(offset));
        }
        assert!(lines.iter().any(|(_, kind, _)| kind.starts_with("final")));
    }
}
