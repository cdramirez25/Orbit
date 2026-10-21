//! Hilo que convierte el audio normalizado en texto: parte el audio en frases (`segmenter`), pide
//! la transcripción al motor y publica parciales y finales.
//!
//! Corre aparte del hilo del volumen: el motor tarda cientos de milisegundos por llamada y las
//! ondas no pueden esperar. Nunca se registra el texto (puede ser una conversación privada).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Instant;

use super::segmenter::{coalesce, Segment, Segmenter};
use super::{Pass, SttEngine, SttError};
use crate::events::{DomainEvent, EventSink, OrbitError};

/// Bucle del hilo. Termina cuando se cierra el canal (se dejó de escuchar) o llega `stop`.
pub fn run(
    receiver: Receiver<Vec<f32>>,
    engine: Arc<dyn SttEngine>,
    events: Arc<dyn EventSink>,
    stop: Arc<AtomicBool>,
) {
    let mut segmenter = Segmenter::new();
    let mut failed = false;

    // Carga el modelo mientras el audio se va acumulando en el canal.
    if let Err(error) = engine.warm_up() {
        report(events.as_ref(), &error);
        failed = error.is_permanent();
    }

    while let Ok(mut samples) = receiver.recv() {
        // La transcripción tarda y el audio sigue llegando: se procesa todo lo acumulado de golpe.
        while let Ok(more) = receiver.try_recv() {
            samples.extend(more);
        }
        if failed {
            continue; // sin modelo no hay nada que hacer; se sigue vaciando el canal
        }

        for segment in coalesce(segmenter.push(&samples)) {
            if stop.load(Ordering::SeqCst) {
                engine.release();
                return;
            }
            let (audio, pass) = match &segment {
                Segment::Partial(audio) => (audio, Pass::Partial),
                Segment::Final(audio) => (audio, Pass::Final),
            };
            let is_final = pass == Pass::Final;

            let started = Instant::now();
            match engine.transcribe(audio, pass) {
                Ok(transcription) => {
                    tracing::debug!(
                        audio_ms = audio.len() / 16,
                        took_ms = started.elapsed().as_millis() as u64,
                        is_final,
                        "frase transcrita"
                    );
                    publish(events.as_ref(), &stop, &transcription.text, is_final);
                }
                Err(error) => {
                    report(events.as_ref(), &error);
                    if error.is_permanent() {
                        failed = true;
                        break;
                    }
                }
            }
        }
    }
    engine.release();
}

fn publish(events: &dyn EventSink, stop: &AtomicBool, text: &str, is_final: bool) {
    // Si se paró mientras el motor trabajaba, el resultado llega tarde: no se muestra.
    if stop.load(Ordering::SeqCst) {
        return;
    }
    let text = text.trim();
    if is_non_speech(text) {
        return;
    }
    let event = if is_final {
        DomainEvent::SttFinal {
            text: text.to_string(),
            end_of_utterance: true,
        }
    } else {
        DomainEvent::SttPartial {
            text: text.to_string(),
        }
    };
    events.publish(event);
}

fn report(events: &dyn EventSink, error: &SttError) {
    tracing::warn!(code = error.code(), %error, "la transcripción falló");
    events.publish(DomainEvent::Error(OrbitError {
        code: error.code().to_string(),
        message: error.to_string(),
        recoverable: true,
    }));
}

/// Whisper escribe marcas como `[BLANK_AUDIO]`, `(música)` o `♪` cuando no hay voz: no son texto.
fn is_non_speech(text: &str) -> bool {
    if !text.chars().any(char::is_alphanumeric) {
        return true;
    }
    let wrapped = |open: char, close: char| text.starts_with(open) && text.ends_with(close);
    wrapped('[', ']') || wrapped('(', ')') || wrapped('*', '*') || text.starts_with('♪')
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc::channel;
    use std::sync::Mutex;

    use super::*;
    use crate::events::testing::FakeEventSink;
    use crate::stt::Transcription;

    /// Motor simulado: devuelve los textos de la lista, uno por llamada, y cuenta cuánto se usa.
    struct FakeEngine {
        replies: Mutex<Vec<Result<String, ()>>>,
        calls: AtomicUsize,
        released: AtomicUsize,
        warm_up_error: bool,
    }

    impl FakeEngine {
        fn new(replies: Vec<Result<String, ()>>) -> Arc<Self> {
            Arc::new(Self {
                replies: Mutex::new(replies),
                calls: AtomicUsize::new(0),
                released: AtomicUsize::new(0),
                warm_up_error: false,
            })
        }

        fn without_model() -> Arc<Self> {
            Arc::new(Self {
                replies: Mutex::default(),
                calls: AtomicUsize::new(0),
                released: AtomicUsize::new(0),
                warm_up_error: true,
            })
        }
    }

    impl SttEngine for FakeEngine {
        fn transcribe(&self, _samples: &[f32], _pass: Pass) -> Result<Transcription, SttError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let mut replies = self.replies.lock().unwrap();
            if replies.is_empty() {
                return Ok(Transcription {
                    text: String::new(),
                });
            }
            match replies.remove(0) {
                Ok(text) => Ok(Transcription { text }),
                Err(()) => Err(SttError::Inference("boom".into())),
            }
        }

        fn warm_up(&self) -> Result<(), SttError> {
            if self.warm_up_error {
                Err(SttError::ModelMissing("modelo.bin".into()))
            } else {
                Ok(())
            }
        }

        fn release(&self) {
            self.released.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn tone(millis: usize) -> Vec<f32> {
        (0..16 * millis)
            .map(|i| 0.2 * (i as f32 * 0.3).sin())
            .collect()
    }

    /// Ejecuta el transcriptor con el audio dado y devuelve los eventos publicados.
    fn run_with(engine: &Arc<FakeEngine>, audio: Vec<Vec<f32>>) -> Vec<DomainEvent> {
        let events = Arc::new(FakeEventSink::default());
        let (tx, rx) = channel();
        for chunk in audio {
            tx.send(chunk).unwrap();
        }
        drop(tx);
        run(
            rx,
            engine.clone(),
            events.clone(),
            Arc::new(AtomicBool::new(false)),
        );
        events.events()
    }

    #[test]
    fn a_spoken_phrase_publishes_a_partial_and_then_the_final() {
        let engine = FakeEngine::new(vec![Ok("hola".into()), Ok("hola mundo".into())]);
        let events = Arc::new(FakeEventSink::default());
        let (tx, rx) = channel();
        let handle = std::thread::spawn({
            let engine: Arc<dyn SttEngine> = engine.clone();
            let events = events.clone();
            move || run(rx, engine, events, Arc::new(AtomicBool::new(false)))
        });

        // 1 s de voz → llega un parcial. El audio se manda poco a poco: si llegara todo junto, el
        // parcial ya estaría obsoleto cuando se cierra la frase y solo saldría el final.
        tx.send(tone(1000)).unwrap();
        let deadline = Instant::now() + std::time::Duration::from_secs(3);
        while Instant::now() < deadline && events.events().is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        // 1 s de silencio cierra la frase.
        tx.send(vec![0.0; 16_000]).unwrap();
        drop(tx);
        handle.join().unwrap();

        assert_eq!(
            events.events(),
            vec![
                DomainEvent::SttPartial {
                    text: "hola".into()
                },
                DomainEvent::SttFinal {
                    text: "hola mundo".into(),
                    end_of_utterance: true
                },
            ]
        );
        assert_eq!(engine.released.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn audio_that_arrives_in_one_batch_skips_the_obsolete_partial() {
        let engine = FakeEngine::new(vec![Ok("hola mundo".into())]);
        let events = run_with(&engine, vec![tone(1000), vec![0.0; 16_000]]);

        assert_eq!(
            events,
            vec![DomainEvent::SttFinal {
                text: "hola mundo".into(),
                end_of_utterance: true
            }]
        );
        assert_eq!(engine.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn silence_never_calls_the_engine() {
        let engine = FakeEngine::new(vec![]);
        let events = run_with(&engine, vec![vec![0.0; 16_000 * 3]]);

        assert!(events.is_empty());
        assert_eq!(engine.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn non_speech_marks_are_not_published() {
        let engine = FakeEngine::new(vec![Ok("[BLANK_AUDIO]".into()), Ok(" (música) ".into())]);
        let events = run_with(&engine, vec![tone(1000), vec![0.0; 16_000]]);
        assert!(events.is_empty());
    }

    #[test]
    fn text_is_trimmed() {
        let engine = FakeEngine::new(vec![Ok("  hola ".into())]);
        let events = run_with(&engine, vec![tone(500), vec![0.0; 16_000]]);
        assert_eq!(
            events,
            vec![DomainEvent::SttFinal {
                text: "hola".into(),
                end_of_utterance: true
            }]
        );
    }

    #[test]
    fn a_missing_model_is_reported_once_and_audio_is_ignored() {
        let engine = FakeEngine::without_model();
        let events = run_with(&engine, vec![tone(1000), vec![0.0; 16_000], tone(1000)]);

        let errors: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, DomainEvent::Error(OrbitError { code, .. }) if code == "stt.modelMissing"))
            .collect();
        assert_eq!(errors.len(), 1);
        assert_eq!(events.len(), 1);
        assert_eq!(engine.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_failed_inference_is_reported_and_the_next_phrase_still_works() {
        let engine = FakeEngine::new(vec![Err(()), Ok("segunda".into())]);
        let events = run_with(
            &engine,
            vec![tone(500), vec![0.0; 16_000], tone(500), vec![0.0; 16_000]],
        );

        assert!(events.iter().any(
            |e| matches!(e, DomainEvent::Error(OrbitError { code, .. }) if code == "stt.inference")
        ));
        assert!(events.contains(&DomainEvent::SttFinal {
            text: "segunda".into(),
            end_of_utterance: true
        }));
    }

    #[test]
    fn nothing_is_published_after_stopping() {
        let engine = FakeEngine::new(vec![Ok("tarde".into())]);
        let events = Arc::new(FakeEventSink::default());
        let (tx, rx) = channel();
        tx.send(tone(500)).unwrap();
        tx.send(vec![0.0; 16_000]).unwrap();
        drop(tx);

        let stop = Arc::new(AtomicBool::new(true));
        run(rx, engine.clone(), events.clone(), stop);

        assert!(events.events().is_empty());
        assert_eq!(engine.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn non_speech_detection() {
        for mark in [
            "",
            "...",
            "[Music]",
            "(música)",
            "♪ la la ♪",
            "*aplausos*",
            "  ",
        ] {
            assert!(is_non_speech(mark.trim()), "{mark:?}");
        }
        for speech in ["hola", "Hello, world.", "¿Cuál es la capital?", "2 + 2"] {
            assert!(!is_non_speech(speech), "{speech:?}");
        }
    }
}
