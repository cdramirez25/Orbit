//! El Prompter: le hace una pregunta al proveedor de IA activo con el contexto de la sesión activa
//! (su prompt y todo lo preguntado antes) y la respuesta va llegando a la isla (`llm:start`,
//! `llm:delta`, `llm:done`). Si llega otra pregunta, la respuesta anterior se corta. Al terminar bien,
//! la pregunta y la respuesta quedan en la sesión: así la IA recuerda toda la sesión.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;

use super::recorder::QuestionRecorder;
use super::AiService;
use crate::events::{DomainEvent, EventSink, OrbitError};
use crate::sessions::SessionService;

/// Lo que se le dice al modelo siempre; el prompt de la sesión se añade detrás.
const BASE_PROMPT: &str = "Eres un asistente que responde en vivo, en una pantalla pequeña, \
durante una sesión de preguntas. Responde SIEMPRE en el mismo idioma de la pregunta. Por defecto da \
primero la respuesta directa en una frase corta y, solo si ayuda, una segunda frase breve de \
contexto; sin saludos ni títulos. Puedes resaltar lo clave con **negritas** y usar listas cortas si \
hacen falta. Recuerda lo ya hablado en la sesión. Si las instrucciones de la sesión piden otro \
estilo o extensión, síguelas.";
/// Tope de la respuesta: unas pocas frases, más lo que gaste un modelo que "piensa" antes de contestar.
const MAX_TOKENS: u32 = 500;
/// Una pregunta más larga que esto se recorta (una transcripción larguísima no debe salir cara).
const MAX_QUESTION_CHARS: usize = 600;
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

/// El prompt completo: lo de siempre y, detrás, las instrucciones de la sesión (si puso alguna).
fn system_prompt(session_prompt: &str) -> String {
    if session_prompt.trim().is_empty() {
        BASE_PROMPT.to_string()
    } else {
        format!(
            "{BASE_PROMPT}\n\nInstrucciones de esta sesión (síguelas siempre):\n{session_prompt}"
        )
    }
}

pub struct Prompter {
    ai: Arc<AiService>,
    sessions: Arc<SessionService>,
    events: Arc<dyn EventSink>,
    /// Número de la última pregunta: una respuesta que ya no es la última se corta.
    generation: Arc<AtomicU64>,
}

impl Prompter {
    pub fn new(
        ai: Arc<AiService>,
        sessions: Arc<SessionService>,
        events: Arc<dyn EventSink>,
    ) -> Self {
        Self {
            ai,
            sessions,
            events,
            generation: Arc::new(AtomicU64::new(0)),
        }
    }

    #[cfg(test)]
    pub fn ai_for_tests(&self) -> &AiService {
        &self.ai
    }

    /// ¿La sesión activa contesta sola las preguntas que oiga?
    pub fn auto_answer(&self) -> bool {
        self.sessions.auto_answer()
    }

    /// Hace la pregunta en un hilo aparte (el proveedor puede tardar) y publica la respuesta. Una
    /// pregunta vacía no se hace, y una larguísima se recorta.
    pub fn ask(&self, question: String) {
        let question: String = question.trim().chars().take(MAX_QUESTION_CHARS).collect();
        if question.is_empty() {
            return;
        }
        let id = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let ai = Arc::clone(&self.ai);
        let sessions = Arc::clone(&self.sessions);
        let events = Arc::clone(&self.events);
        let generation = Arc::clone(&self.generation);
        let spawned = thread::Builder::new()
            .name("orbit-answer".into())
            .spawn(move || {
                let current = || generation.load(Ordering::SeqCst) == id;
                // Sin sesión activa (o si la base falla) se contesta igual, solo que sin memoria.
                let context = sessions.context().unwrap_or_else(|error| {
                    tracing::warn!(
                        code = error.code(),
                        "no se pudo leer el contexto de la sesión"
                    );
                    None
                });
                let (system, history) = match &context {
                    Some(context) => (system_prompt(&context.prompt), context.history.clone()),
                    None => (system_prompt(""), Vec::new()),
                };

                events.publish(DomainEvent::LlmStart {
                    question: question.clone(),
                });
                let mut answer = String::new();
                let provider = context.as_ref().and_then(|context| context.provider);
                let result = ai.ask(
                    provider,
                    &system,
                    &history,
                    &question,
                    MAX_TOKENS,
                    &mut |delta| {
                        if !current() {
                            return false;
                        }
                        answer.push_str(delta);
                        events.publish(DomainEvent::LlmDelta {
                            text: delta.to_string(),
                        });
                        true
                    },
                );
                if !current() {
                    return; // llegó otra pregunta: esa es la que manda
                }
                match result {
                    Ok(()) => {
                        // Solo una respuesta completa entra al historial: una cortada o fallida no.
                        if let Some(context) = &context {
                            match sessions.record_exchange(context.session, &question, &answer) {
                                Ok(()) => events.publish(DomainEvent::SessionsChanged),
                                Err(error) => tracing::warn!(
                                    code = error.code(),
                                    "no se pudo guardar la respuesta en la sesión"
                                ),
                            }
                        }
                    }
                    Err(error) => {
                        tracing::warn!(code = error.code(), "no se pudo responder la pregunta");
                        events.publish(DomainEvent::Error(OrbitError {
                            code: error.code().to_string(),
                            message: error.to_string(),
                            recoverable: true,
                        }));
                    }
                }
                events.publish(DomainEvent::LlmDone);
            });
        if let Err(error) = spawned {
            tracing::warn!(%error, "no se pudo iniciar el hilo de la respuesta");
        }
    }
}

/// Sumidero que reenvía todo y mira las frases terminadas: si se está grabando una pregunta, la
/// apunta; si no, y la sesión activa contesta sola, contesta las que son preguntas. Así la
/// transcripción no sabe nada de la IA (§4.0).
pub struct AnsweringSink {
    inner: Arc<dyn EventSink>,
    prompter: Arc<Prompter>,
    recorder: Arc<QuestionRecorder>,
}

impl AnsweringSink {
    pub fn new(
        inner: Arc<dyn EventSink>,
        prompter: Arc<Prompter>,
        recorder: Arc<QuestionRecorder>,
    ) -> Self {
        Self {
            inner,
            prompter,
            recorder,
        }
    }
}

impl EventSink for AnsweringSink {
    fn publish(&self, event: DomainEvent) {
        let auto_question = match &event {
            DomainEvent::SttFinal { text, .. } => {
                // Grabando, la frase es parte de la pregunta y se contesta al terminar, no ahora.
                if self.recorder.collect(text) {
                    None
                } else if is_question(text) && self.prompter.auto_answer() {
                    Some(text.clone())
                } else {
                    None
                }
            }
            _ => None,
        };
        self.inner.publish(event);
        if let Some(question) = auto_question {
            self.prompter.ask(question);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::ai::providers::ProviderId;
    use crate::ai::testing::{FakeClient, FakeConfig, FakeSecrets};
    use crate::ai::{LlmClient, Request, Role, SaveInput, Target};
    use crate::events::testing::FakeEventSink;
    use crate::sessions::testing::service as session_service;

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

    #[test]
    fn the_session_prompt_goes_after_the_base_instructions() {
        assert_eq!(system_prompt("  "), BASE_PROMPT);
        let prompt = system_prompt("Responde como un pirata");
        assert!(prompt.starts_with(BASE_PROMPT));
        assert!(prompt.ends_with("Responde como un pirata"));
        assert!(prompt.contains("Instrucciones de esta sesión"));
    }

    struct Harness {
        sink: AnsweringSink,
        prompter: Arc<Prompter>,
        recorder: Arc<QuestionRecorder>,
        sessions: Arc<SessionService>,
        events: Arc<FakeEventSink>,
        client: Arc<FakeClient>,
    }

    /// `active`: con proveedor (Groq) listo. Las sesiones se crean aparte, con `sessions`.
    fn harness(active: bool) -> Harness {
        let secrets = Arc::new(FakeSecrets::default());
        let client = Arc::new(FakeClient::default());
        let ai = Arc::new(AiService::new(
            Box::new(Arc::clone(&secrets)),
            Box::new(Arc::clone(&client)),
            Box::new(Arc::new(FakeConfig::default())),
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
            ai.set_active(Some(ProviderId::Groq)).unwrap();
        }
        let sessions = Arc::new(session_service());
        let events = Arc::new(FakeEventSink::default());
        let prompter = Arc::new(Prompter::new(ai, Arc::clone(&sessions), events.clone()));
        let recorder = Arc::new(QuestionRecorder::default());
        Harness {
            sink: AnsweringSink::new(events.clone(), Arc::clone(&prompter), Arc::clone(&recorder)),
            prompter,
            recorder,
            sessions,
            events,
            client,
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

    fn done(events: &FakeEventSink) -> bool {
        wait_for(events, |e| e.contains(&DomainEvent::LlmDone))
    }

    fn final_text(text: &str) -> DomainEvent {
        DomainEvent::SttFinal {
            text: text.into(),
            end_of_utterance: true,
        }
    }

    #[test]
    fn a_question_is_answered_in_order_start_deltas_done() {
        let h = harness(true);
        *h.client.chunks.lock().unwrap() = vec!["Can".into(), "berra".into()];
        h.sessions.create("S", "").unwrap();
        h.sessions
            .update(
                1,
                crate::sessions::SessionUpdate {
                    auto_answer: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();

        h.sink
            .publish(final_text("¿Cuál es la capital de Australia?"));
        assert!(done(&h.events));

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
                DomainEvent::SessionsChanged,
                DomainEvent::LlmDone,
            ]
        );
        assert_eq!(h.client.calls.lock().unwrap()[0].0.model, "llama");
    }

    #[test]
    fn asking_without_a_session_still_answers_but_remembers_nothing() {
        let h = harness(true);
        *h.client.chunks.lock().unwrap() = vec!["ok".into()];

        h.prompter.ask("¿Cuál es la capital de Australia?".into());
        assert!(done(&h.events));

        assert!(!h.events.events().contains(&DomainEvent::SessionsChanged));
        assert!(h.client.histories.lock().unwrap()[0].is_empty());
        assert_eq!(h.client.systems.lock().unwrap()[0], BASE_PROMPT);
    }

    #[test]
    fn the_ai_gets_the_session_prompt_and_everything_asked_before_in_that_session() {
        let h = harness(true);
        let id = h
            .sessions
            .create("Trivia", "Responde como un pirata")
            .unwrap()
            .sessions[0]
            .id;
        *h.client.chunks.lock().unwrap() = vec!["Anotado: 7.".into()];

        h.prompter.ask("Mi número favorito es el 7".into());
        assert!(done(&h.events));
        // Lo preguntado y lo respondido quedó en la sesión.
        let saved: Vec<(Role, String)> = h
            .sessions
            .messages(id)
            .unwrap()
            .into_iter()
            .map(|m| (m.role, m.content))
            .collect();
        assert_eq!(
            saved,
            vec![
                (Role::User, "Mi número favorito es el 7".to_string()),
                (Role::Assistant, "Anotado: 7.".to_string()),
            ]
        );

        // La siguiente pregunta lleva ese historial y el prompt de la sesión.
        *h.client.chunks.lock().unwrap() = vec!["Es el 7.".into()];
        h.prompter.ask("¿Cuál es mi número favorito?".into());
        assert!(wait_for(&h.events, |e| e
            .iter()
            .filter(|x| **x == DomainEvent::LlmDone)
            .count()
            == 2));

        let histories = h.client.histories.lock().unwrap();
        assert!(histories[0].is_empty());
        assert_eq!(histories[1].len(), 2);
        assert_eq!(histories[1][0].content, "Mi número favorito es el 7");
        assert_eq!(histories[1][1].role, Role::Assistant);
        let systems = h.client.systems.lock().unwrap();
        assert!(systems[1].contains("Responde como un pirata"));
    }

    #[test]
    fn a_session_with_its_own_ai_uses_it_and_the_rest_use_the_active_one() {
        let h = harness(true);
        // La IA activa de los ajustes es Groq; la sesión "Con Claude" elige Claude.
        h.prompter
            .ai_for_tests()
            .save(
                ProviderId::Claude,
                SaveInput {
                    api_key: Some("sk-ant".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        let claude = h.sessions.create("Con Claude", "").unwrap().sessions[0].id;
        h.sessions
            .update(
                claude,
                crate::sessions::SessionUpdate {
                    provider: Some("claude".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        *h.client.chunks.lock().unwrap() = vec!["ok".into()];

        h.prompter.ask("¿Pregunta para Claude?".into());
        assert!(done(&h.events));

        h.sessions.create("Normal", "").unwrap();
        h.prompter.ask("¿Pregunta para la activa?".into());
        assert!(wait_for(&h.events, |e| e
            .iter()
            .filter(|x| **x == DomainEvent::LlmDone)
            .count()
            == 2));

        let calls = h.client.calls.lock().unwrap();
        assert_eq!(calls[0].0.id, ProviderId::Claude);
        assert_eq!(calls[1].0.id, ProviderId::Groq);
    }

    #[test]
    fn another_session_does_not_see_the_history_of_the_first() {
        let h = harness(true);
        h.sessions.create("A", "").unwrap();
        *h.client.chunks.lock().unwrap() = vec!["r".into()];
        h.prompter.ask("pregunta de la sesión A".into());
        assert!(done(&h.events));

        h.sessions.create("B", "").unwrap();
        h.prompter.ask("pregunta de la sesión B".into());
        assert!(wait_for(&h.events, |e| e
            .iter()
            .filter(|x| **x == DomainEvent::LlmDone)
            .count()
            == 2));

        assert!(h.client.histories.lock().unwrap()[1].is_empty());
    }

    #[test]
    fn a_failed_answer_is_not_added_to_the_history() {
        let h = harness(true);
        let id = h.sessions.create("S", "").unwrap().sessions[0].id;
        *h.client.error.lock().unwrap() = Some(crate::ai::AiError::Unauthorized);

        h.prompter.ask("¿Cuál es la capital de Australia?".into());
        assert!(done(&h.events));

        let events = h.events.events();
        assert!(events.iter().any(|e| matches!(
            e,
            DomainEvent::Error(OrbitError { code, .. }) if code == "ai.unauthorized"
        )));
        assert!(!events.contains(&DomainEvent::SessionsChanged));
        assert!(h.sessions.messages(id).unwrap().is_empty());
        assert_eq!(events.last(), Some(&DomainEvent::LlmDone));
    }

    #[test]
    fn without_a_provider_the_question_gets_an_error_with_a_code() {
        let h = harness(false);
        h.prompter.ask("¿Cuál es la capital de Australia?".into());
        assert!(done(&h.events));

        assert!(h.events.events().iter().any(|e| matches!(
            e,
            DomainEvent::Error(OrbitError { code, recoverable: true, .. }) if code == "ai.notConfigured"
        )));
    }

    #[test]
    fn by_default_a_heard_question_is_not_answered_by_itself() {
        let h = harness(true);
        h.sessions.create("S", "").unwrap();

        h.sink
            .publish(final_text("¿Cuál es la capital de Australia?"));
        thread::sleep(Duration::from_millis(100));

        assert_eq!(h.events.events().len(), 1, "solo la frase, sin respuesta");
        assert!(h.client.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn with_auto_answer_on_only_the_questions_are_answered() {
        let h = harness(true);
        let id = h.sessions.create("S", "").unwrap().sessions[0].id;
        h.sessions
            .update(
                id,
                crate::sessions::SessionUpdate {
                    auto_answer: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        *h.client.chunks.lock().unwrap() = vec!["ok".into()];

        h.sink
            .publish(final_text("Canberra es la capital de Australia."));
        h.sink.publish(DomainEvent::SttPartial {
            text: "¿Cuál es la capital de Australia?".into(),
        });
        thread::sleep(Duration::from_millis(100));
        assert!(h.client.calls.lock().unwrap().is_empty());

        h.sink
            .publish(final_text("¿Cuál es la capital de Australia?"));
        assert!(done(&h.events));
        assert_eq!(h.client.calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn while_recording_the_phrases_are_collected_and_nothing_is_answered_yet() {
        let h = harness(true);
        let id = h.sessions.create("S", "").unwrap().sessions[0].id;
        h.sessions
            .update(
                id,
                crate::sessions::SessionUpdate {
                    auto_answer: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();

        h.recorder.begin();
        h.sink.publish(final_text("¿Cuál es la capital"));
        h.sink.publish(final_text("de Australia?"));
        thread::sleep(Duration::from_millis(100));

        // Aunque la sesión conteste sola, grabando no se contesta a medias.
        assert!(h.client.calls.lock().unwrap().is_empty());
        assert_eq!(
            h.recorder.finish().as_deref(),
            Some("¿Cuál es la capital de Australia?")
        );
        // Las frases se reenviaron igual a la interfaz (para verlas en vivo).
        assert_eq!(h.events.events().len(), 2);
    }

    #[test]
    fn asking_directly_works_and_empty_or_huge_questions_are_handled() {
        let h = harness(true);
        *h.client.chunks.lock().unwrap() = vec!["ok".into()];

        h.prompter.ask("   ".into()); // vacía: no hace nada
        h.prompter.ask("x".repeat(5_000)); // larguísima: se recorta
        assert!(done(&h.events));

        let calls = h.client.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].2.chars().count(), MAX_QUESTION_CHARS);
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
    fn a_new_question_cuts_the_previous_answer_and_only_the_complete_one_is_remembered() {
        let slow = Arc::new(SlowEcho {
            stops: Mutex::new(Vec::new()),
        });
        let ai = Arc::new(AiService::new(
            Box::new(Arc::new(FakeSecrets::default())),
            Box::new(Arc::clone(&slow)),
            Box::new(Arc::new(FakeConfig::default())),
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
        ai.set_active(Some(ProviderId::Groq)).unwrap();
        let sessions = Arc::new(session_service());
        let id = sessions.create("S", "").unwrap().sessions[0].id;
        let events = Arc::new(FakeEventSink::default());
        let prompter = Prompter::new(ai, Arc::clone(&sessions), events.clone());

        prompter.ask("¿Primera pregunta de prueba?".into());
        assert!(wait_for(&events, |e| e
            .iter()
            .any(|x| matches!(x, DomainEvent::LlmDelta { .. }))));
        prompter.ask("¿Segunda pregunta de prueba?".into());
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
        // En el historial solo está la pregunta completa.
        let saved = sessions.messages(id).unwrap();
        assert_eq!(saved.len(), 2);
        assert!(saved[0].content.starts_with("¿Segunda"));
    }
}
