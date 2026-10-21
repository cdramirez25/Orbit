//! El Prompter: cuando una frase terminada es una pregunta, se la hace al proveedor de IA activo y
//! la respuesta va llegando a la isla (`llm:start`, `llm:delta`, `llm:done`). Si llega otra pregunta,
//! la respuesta anterior se corta.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;

use super::AiService;
use crate::events::{DomainEvent, EventSink, OrbitError};

/// Lo que se le dice al modelo: respuestas cortas, en el idioma de la pregunta, listas para leer.
const SYSTEM_PROMPT: &str = "Eres un asistente que responde en vivo, en una pantalla pequeña, \
durante una partida de preguntas. Responde SIEMPRE en el mismo idioma de la pregunta. Da primero \
la respuesta directa en una frase corta y, solo si ayuda, una segunda frase breve de contexto. \
Sin saludos, sin listas y sin formato markdown. Si la frase no es una pregunta, responde solo: -";
/// Tope de la respuesta: unas pocas frases, más lo que gaste un modelo que "piensa" antes de contestar.
const MAX_TOKENS: u32 = 500;
/// Una pregunta de menos palabras que esto es ruido ("¿sí?", "¿eh?").
const MIN_WORDS: usize = 3;

/// Palabras con las que suele empezar una pregunta cuando no hay signos de interrogación.
const STARTERS: [&str; 22] = [
    "qué", "cuál", "cuáles", "cuándo", "cuánto", "cuánta", "cuántos", "cuántas", "dónde", "quién",
    "quiénes", "cómo", "por qué", "what", "which", "when", "where", "who", "whom", "whose", "why",
    "how",
];

/// ¿La frase es una pregunta? Con signos de interrogación o empezando por una palabra interrogativa.
pub fn is_question(text: &str) -> bool {
    let text = text.trim();
    if text.split_whitespace().count() < MIN_WORDS {
        return false;
    }
    if text.contains('?') || text.contains('¿') {
        return true;
    }
    let lower = text.to_lowercase();
    let start = lower.trim_start_matches(|c: char| !c.is_alphanumeric());
    STARTERS.iter().any(|starter| {
        start
            .strip_prefix(starter)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !c.is_alphanumeric()))
    })
}

pub struct Prompter {
    ai: Arc<AiService>,
    events: Arc<dyn EventSink>,
    /// Número de la última pregunta: una respuesta que ya no es la última se corta.
    generation: Arc<AtomicU64>,
}

impl Prompter {
    pub fn new(ai: Arc<AiService>, events: Arc<dyn EventSink>) -> Self {
        Self {
            ai,
            events,
            generation: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Hace la pregunta en un hilo aparte (el proveedor puede tardar) y publica la respuesta.
    pub fn ask(&self, question: String) {
        let id = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let ai = Arc::clone(&self.ai);
        let events = Arc::clone(&self.events);
        let generation = Arc::clone(&self.generation);
        let spawned = thread::Builder::new()
            .name("orbit-answer".into())
            .spawn(move || {
                let current = || generation.load(Ordering::SeqCst) == id;
                events.publish(DomainEvent::LlmStart {
                    question: question.clone(),
                });
                let result = ai.ask(SYSTEM_PROMPT, &question, MAX_TOKENS, &mut |delta| {
                    if !current() {
                        return false;
                    }
                    events.publish(DomainEvent::LlmDelta {
                        text: delta.to_string(),
                    });
                    true
                });
                if !current() {
                    return; // llegó otra pregunta: esa es la que manda
                }
                if let Err(error) = result {
                    tracing::warn!(code = error.code(), "no se pudo responder la pregunta");
                    events.publish(DomainEvent::Error(OrbitError {
                        code: error.code().to_string(),
                        message: error.to_string(),
                        recoverable: true,
                    }));
                }
                events.publish(DomainEvent::LlmDone);
            });
        if let Err(error) = spawned {
            tracing::warn!(%error, "no se pudo iniciar el hilo de la respuesta");
        }
    }
}

/// Sumidero que reenvía todo y, cuando una frase terminada es una pregunta, la contesta. Así la
/// transcripción no sabe nada de la IA (§4.0).
pub struct AnsweringSink {
    inner: Arc<dyn EventSink>,
    prompter: Prompter,
}

impl AnsweringSink {
    pub fn new(inner: Arc<dyn EventSink>, prompter: Prompter) -> Self {
        Self { inner, prompter }
    }
}

impl EventSink for AnsweringSink {
    fn publish(&self, event: DomainEvent) {
        let question = match &event {
            DomainEvent::SttFinal { text, .. } if is_question(text) => Some(text.clone()),
            _ => None,
        };
        self.inner.publish(event);
        if let Some(question) = question {
            self.prompter.ask(question);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::ai::providers::ProviderId;
    use crate::ai::testing::{FakeClient, FakeSecrets};
    use crate::ai::{LlmClient, Request, SaveInput, Target};
    use crate::events::testing::FakeEventSink;

    #[test]
    fn questions_are_detected_in_spanish_and_english() {
        for question in [
            "¿Cuál es la capital de Australia?",
            "cuál es la capital de Australia",
            "Quién escribió Don Quijote",
            "Por qué el cielo es azul",
            "What is the capital of Australia",
            "How many planets are there?",
            "La capital de Australia es Canberra, ¿verdad?",
            "¡Cómo se llama el río más largo!",
        ] {
            assert!(is_question(question), "{question}");
        }
    }

    #[test]
    fn statements_and_noise_are_not_questions() {
        for text in [
            "",
            "   ",
            "Canberra es la capital de Australia.",
            "¿Sí?",
            "What?",
            "Gracias por ver el video",
            "Quienes somos nosotros", // sin tilde no es la palabra interrogativa
            "Howard Hughes fue un millonario",
        ] {
            assert!(!is_question(text), "{text}");
        }
    }

    struct Harness {
        sink: AnsweringSink,
        events: Arc<FakeEventSink>,
        client: Arc<FakeClient>,
        path: PathBuf,
    }

    impl Drop for Harness {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    fn harness(name: &str, active: bool) -> Harness {
        let secrets = Arc::new(FakeSecrets::default());
        let client = Arc::new(FakeClient::default());
        let path =
            std::env::temp_dir().join(format!("orbit-prompter-{}-{name}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let ai = Arc::new(AiService::new(
            Box::new(Arc::clone(&secrets)),
            Box::new(Arc::clone(&client)),
            path.clone(),
        ));
        if active {
            ai.save(
                ProviderId::Groq,
                SaveInput {
                    api_key: Some("gsk_x".into()),
                    model: Some("llama".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
            ai.set_active(Some(ProviderId::Groq));
        }
        let events = Arc::new(FakeEventSink::default());
        let prompter = Prompter::new(ai, events.clone());
        Harness {
            sink: AnsweringSink::new(events.clone(), prompter),
            events,
            client,
            path,
        }
    }

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

    fn final_text(text: &str) -> DomainEvent {
        DomainEvent::SttFinal {
            text: text.into(),
            end_of_utterance: true,
        }
    }

    #[test]
    fn a_question_is_answered_in_order_start_deltas_done() {
        let h = harness("answer", true);
        *h.client.chunks.lock().unwrap() = vec!["Can".into(), "berra".into()];

        h.sink
            .publish(final_text("¿Cuál es la capital de Australia?"));
        assert!(wait_for(&h.events, |e| e.contains(&DomainEvent::LlmDone)));

        assert_eq!(
            h.events.events(),
            vec![
                final_text("¿Cuál es la capital de Australia?"),
                DomainEvent::LlmStart {
                    question: "¿Cuál es la capital de Australia?".into()
                },
                DomainEvent::LlmDelta { text: "Can".into() },
                DomainEvent::LlmDelta {
                    text: "berra".into()
                },
                DomainEvent::LlmDone,
            ]
        );
        let calls = h.client.calls.lock().unwrap();
        assert_eq!(calls[0].2, "¿Cuál es la capital de Australia?");
        assert_eq!(calls[0].0.model, "llama");
    }

    #[test]
    fn a_statement_is_only_forwarded() {
        let h = harness("statement", true);
        h.sink
            .publish(final_text("Canberra es la capital de Australia."));
        h.sink.publish(DomainEvent::SttPartial {
            text: "¿Cuál es la capital de Australia?".into(),
        });
        thread::sleep(Duration::from_millis(100));

        assert_eq!(h.events.events().len(), 2);
        assert!(h.client.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn without_a_provider_the_question_gets_an_error_with_a_code() {
        let h = harness("noprovider", false);
        h.sink
            .publish(final_text("¿Cuál es la capital de Australia?"));
        assert!(wait_for(&h.events, |e| e.contains(&DomainEvent::LlmDone)));

        assert!(h.events.events().iter().any(|e| matches!(
            e,
            DomainEvent::Error(OrbitError { code, recoverable: true, .. }) if code == "ai.notConfigured"
        )));
    }

    #[test]
    fn a_provider_error_is_reported_and_the_answer_is_closed() {
        let h = harness("failing", true);
        *h.client.error.lock().unwrap() = Some(crate::ai::AiError::Unauthorized);
        h.sink
            .publish(final_text("¿Cuál es la capital de Australia?"));
        assert!(wait_for(&h.events, |e| e.contains(&DomainEvent::LlmDone)));

        let events = h.events.events();
        assert!(events.iter().any(|e| matches!(
            e,
            DomainEvent::Error(OrbitError { code, .. }) if code == "ai.unauthorized"
        )));
        assert_eq!(events.last(), Some(&DomainEvent::LlmDone));
    }

    /// Cliente lento que repite la pregunta en trozos, para ver cómo se corta.
    struct SlowEcho {
        stops: Mutex<Vec<String>>,
    }

    impl LlmClient for Arc<SlowEcho> {
        fn stream(
            &self,
            _target: &Target,
            request: &Request<'_>,
            on_delta: &mut dyn FnMut(&str) -> bool,
        ) -> Result<(), crate::ai::AiError> {
            for _ in 0..40 {
                if !on_delta(request.user) {
                    self.stops.lock().unwrap().push(request.user.to_string());
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(10));
            }
            Ok(())
        }

        fn models(&self, _target: &Target) -> Result<Vec<String>, crate::ai::AiError> {
            Ok(Vec::new())
        }
    }

    #[test]
    fn a_new_question_cuts_the_previous_answer() {
        let secrets = Arc::new(FakeSecrets::default());
        let slow = Arc::new(SlowEcho {
            stops: Mutex::new(Vec::new()),
        });
        let path =
            std::env::temp_dir().join(format!("orbit-prompter-{}-cut.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let ai = Arc::new(AiService::new(
            Box::new(Arc::clone(&secrets)),
            Box::new(Arc::clone(&slow)),
            path.clone(),
        ));
        ai.save(
            ProviderId::Groq,
            SaveInput {
                api_key: Some("k".into()),
                model: Some("m".into()),
                ..SaveInput::default()
            },
        )
        .unwrap();
        ai.set_active(Some(ProviderId::Groq));
        let events = Arc::new(FakeEventSink::default());
        let sink = AnsweringSink::new(events.clone(), Prompter::new(ai, events.clone()));

        sink.publish(final_text("¿Primera pregunta de prueba?"));
        assert!(wait_for(&events, |e| e
            .iter()
            .any(|x| matches!(x, DomainEvent::LlmDelta { .. }))));
        sink.publish(final_text("¿Segunda pregunta de prueba?"));
        assert!(wait_for(&events, |e| e.contains(&DomainEvent::LlmDone)));
        thread::sleep(Duration::from_millis(100));

        let all = events.events();
        let second_start = all
            .iter()
            .position(|e| matches!(e, DomainEvent::LlmStart { question } if question.starts_with("¿Segunda")))
            .unwrap();
        // Después de empezar la segunda, no llega ningún trozo de la primera.
        assert!(!all[second_start..]
            .iter()
            .any(|e| matches!(e, DomainEvent::LlmDelta { text } if text.starts_with("¿Primera"))));
        // La primera no cierra con `llm:done`: solo cierra la segunda.
        assert_eq!(
            all.iter().filter(|e| **e == DomainEvent::LlmDone).count(),
            1
        );
        assert_eq!(slow.stops.lock().unwrap().len(), 1);
        let _ = std::fs::remove_file(&path);
    }
}
