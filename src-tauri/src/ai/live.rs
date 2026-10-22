//! Pruebas manuales con un proveedor real (necesitan red y una clave). Todas llevan `#[ignore]`:
//! `ORBIT_TEST_GROQ_KEY=... cargo test live_groq -- --ignored --nocapture`.
//! Imprimen lo que pasó y nunca la clave.

use std::sync::Arc;
use std::time::{Duration, Instant};

use super::client::HttpLlm;
use super::prompter::{AnsweringSink, Prompter};
use super::providers::ProviderId;
use super::recorder::QuestionRecorder;
use super::testing::{FakeConfig, FakeSecrets};
use super::{AiService, SaveInput};
use crate::events::testing::FakeEventSink;
use crate::events::{DomainEvent, EventSink};

/// Modelos de Groq que se prueban en orden hasta que uno responda.
const MODELS: [&str; 2] = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];

fn key() -> String {
    std::env::var("ORBIT_TEST_GROQ_KEY").expect("falta ORBIT_TEST_GROQ_KEY")
}

fn save_and_pick_a_model(ai: &AiService) -> &'static str {
    for model in MODELS {
        ai.save(
            ProviderId::Groq,
            SaveInput {
                api_key: Some(key()),
                model: Some(model.into()),
                ..SaveInput::default()
            },
        )
        .expect("no se pudo guardar");
        match ai.test(ProviderId::Groq) {
            Ok(reply) => {
                eprintln!("modelo {model}: respondió {reply:?}");
                return model;
            }
            Err(error) => eprintln!("modelo {model}: {} ({error})", error.code()),
        }
    }
    panic!("ningún modelo funcionó");
}

/// Una pregunta "hablada" llega como frase final y la respuesta sale en streaming, con la clave
/// guardada por el servicio y el cliente HTTP real.
#[test]
#[ignore = "usa la red y una clave real en ORBIT_TEST_GROQ_KEY"]
fn live_groq_answers_a_spoken_question_end_to_end() {
    let secrets = Arc::new(FakeSecrets::default());
    let ai = Arc::new(AiService::new(
        Box::new(Arc::clone(&secrets)),
        Box::new(HttpLlm::new()),
        Box::new(Arc::new(FakeConfig::default())),
    ));
    save_and_pick_a_model(&ai);
    ai.set_active(Some(ProviderId::Groq))
        .expect("no se pudo elegir");

    let sessions = Arc::new(crate::sessions::testing::service());
    // La sesión contesta sola las preguntas que oiga (lo normal es el botón; aquí se prueba el camino).
    let id = sessions.create("Prueba", "").expect("sesión").sessions[0].id;
    sessions
        .update(
            id,
            crate::sessions::SessionUpdate {
                auto_answer: Some(true),
                ..Default::default()
            },
        )
        .expect("sesión");
    let events = Arc::new(FakeEventSink::default());
    let sink = AnsweringSink::new(
        events.clone(),
        Arc::new(Prompter::new(ai, sessions, events.clone())),
        Arc::new(QuestionRecorder::default()),
    );
    let started = Instant::now();
    sink.publish(DomainEvent::SttFinal {
        text: "¿Cuál es la capital de Australia?".into(),
        end_of_utterance: true,
    });

    let mut first_delta = None;
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        let seen = events.events();
        if first_delta.is_none()
            && seen
                .iter()
                .any(|e| matches!(e, DomainEvent::LlmDelta { .. }))
        {
            first_delta = Some(started.elapsed());
        }
        if seen.contains(&DomainEvent::LlmDone) {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }

    let seen = events.events();
    let answer: String = seen
        .iter()
        .filter_map(|e| match e {
            DomainEvent::LlmDelta { text } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    eprintln!(
        "primer trozo a los {:?}; total {:?}",
        first_delta,
        started.elapsed()
    );
    eprintln!("respuesta: {answer}");

    assert!(seen.contains(&DomainEvent::LlmDone), "no terminó");
    assert!(
        !seen.iter().any(|e| matches!(e, DomainEvent::Error(_))),
        "hubo un error: {seen:?}"
    );
    assert!(
        answer.to_lowercase().contains("canberra"),
        "respuesta inesperada: {answer}"
    );
}

/// La IA recuerda toda la sesión y sigue el prompt de esa sesión: se le dice un dato en una pregunta
/// y se le pregunta en otra, con un prompt que cambia cómo contesta.
#[test]
#[ignore = "usa la red y una clave real en ORBIT_TEST_GROQ_KEY"]
fn live_groq_remembers_the_whole_session_and_follows_its_prompt() {
    let ai = Arc::new(AiService::new(
        Box::new(Arc::new(FakeSecrets::default())),
        Box::new(HttpLlm::new()),
        Box::new(Arc::new(FakeConfig::default())),
    ));
    save_and_pick_a_model(&ai);
    ai.set_active(Some(ProviderId::Groq))
        .expect("no se pudo elegir");

    let sessions = Arc::new(crate::sessions::testing::service());
    sessions
        .create(
            "Con prompt",
            "Termina SIEMPRE tu respuesta con la palabra ARRR, sea cual sea la pregunta.",
        )
        .expect("sesión");
    let events = Arc::new(FakeEventSink::default());
    let prompter = Prompter::new(ai, Arc::clone(&sessions), events.clone());

    let mut answers = Vec::new();
    for (round, question) in [
        "Mi número favorito es el 7. Recuérdalo.",
        "Mi color favorito es el verde.",
        "¿Cuál es mi número favorito y cuál es mi color favorito?",
    ]
    .into_iter()
    .enumerate()
    {
        prompter.ask(question.into());
        let deadline = Instant::now() + Duration::from_secs(25);
        while Instant::now() < deadline
            && events
                .events()
                .iter()
                .filter(|e| **e == DomainEvent::LlmDone)
                .count()
                <= round
        {
            std::thread::sleep(Duration::from_millis(20));
        }
        let seen = events.events();
        let text: String = seen
            .iter()
            .rev()
            .take_while(|e| !matches!(e, DomainEvent::LlmStart { .. }))
            .filter_map(|e| match e {
                DomainEvent::LlmDelta { text } => Some(text.clone()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        eprintln!("pregunta {}: {text}", round + 1);
        answers.push(text);
    }

    let last = answers[2].to_lowercase();
    assert!(last.contains('7'), "no recordó el número: {last}");
    assert!(
        last.contains("verde") || last.contains("green"),
        "no recordó el color: {last}"
    );
    for (index, answer) in answers.iter().enumerate() {
        assert!(
            answer.to_lowercase().contains("arrr"),
            "la respuesta {} no siguió el prompt: {answer}",
            index + 1
        );
    }
}

/// Guarda la clave de verdad en la base de datos de la app (`orbit.db`) y deja Groq activo, como lo
/// haría la pantalla de ajustes, y comprueba que esa clave guardada funciona.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "escribe en la base de datos real de Orbit"]
fn live_groq_saves_the_key_in_the_real_database() {
    use super::sqlite::SqliteAiStore;
    use crate::db::Db;

    let home = std::env::var("HOME").expect("falta HOME");
    let path = std::path::PathBuf::from(home)
        .join("Library/Application Support/dev.orbit.island/orbit.db");
    let db = Db::open(&path).expect("no se pudo abrir la base de datos");
    let ai = AiService::new(
        Box::new(SqliteAiStore::new(db.clone())),
        Box::new(HttpLlm::new()),
        Box::new(SqliteAiStore::new(db)),
    );
    let model = save_and_pick_a_model(&ai);
    let status = ai
        .set_active(Some(ProviderId::Groq))
        .expect("no se pudo elegir");

    let groq = status
        .providers
        .iter()
        .find(|p| p.id == ProviderId::Groq)
        .expect("Groq está en la lista");
    eprintln!(
        "activo: {:?}, clave guardada: {}, modelo: {:?}",
        status.active, groq.has_key, groq.model
    );
    assert_eq!(status.active, Some(ProviderId::Groq));
    assert!(groq.has_key, "la clave no quedó guardada");
    assert_eq!(groq.model.as_deref(), Some(model));
}

// ───────────────────────────── Gemini ─────────────────────────────

fn gemini_service(key: &str, model: Option<&str>) -> AiService {
    let ai = AiService::new(
        Box::new(Arc::new(FakeSecrets::default())),
        Box::new(HttpLlm::new()),
        Box::new(Arc::new(FakeConfig::default())),
    );
    ai.save(
        ProviderId::Gemini,
        SaveInput {
            api_key: Some(key.into()),
            model: model.map(str::to_string),
            ..SaveInput::default()
        },
    )
    .expect("no se pudo guardar");
    ai
}

/// Con la clave real: la lista de modelos llega limpia y la respuesta es una de las dos esperadas:
/// texto de Gemini (clave con créditos) o `ai.noCredits` (clave sin créditos). Una clave mala debe
/// dar `ai.unauthorized`.
///
/// `ORBIT_TEST_GEMINI_KEY=... [ORBIT_TEST_GEMINI_MODEL=gemini-2.5-flash] cargo test live_gemini -- --ignored --nocapture`
#[test]
#[ignore = "usa la red y una clave real en ORBIT_TEST_GEMINI_KEY"]
fn live_gemini_lists_models_and_answers_or_reports_missing_credits() {
    let key = std::env::var("ORBIT_TEST_GEMINI_KEY").expect("falta ORBIT_TEST_GEMINI_KEY");
    let model = std::env::var("ORBIT_TEST_GEMINI_MODEL").ok();
    let ai = gemini_service(&key, model.as_deref());

    let models = ai
        .models_with_key(ProviderId::Gemini, None)
        .expect("no listó los modelos");
    eprintln!("{} modelos de texto: {models:?}", models.len());
    assert!(!models.is_empty());
    assert!(models
        .iter()
        .all(|id| !id.starts_with("models/") && !id.contains("tts") && !id.contains("image")));
    let default = ProviderId::Gemini.spec().default_model.unwrap_or_default();
    assert!(
        models.iter().any(|id| id == default),
        "el modelo por defecto {default} ya no está en la lista de Gemini"
    );

    match ai.test(ProviderId::Gemini) {
        Ok(reply) => eprintln!("Gemini respondió ({} caracteres)", reply.chars().count()),
        Err(error) => {
            eprintln!("Gemini devolvió {} ({error})", error.code());
            assert_eq!(error.code(), "ai.noCredits");
        }
    }

    let wrong = gemini_service("AQ.clave-que-no-existe", model.as_deref());
    assert_eq!(
        wrong.test(ProviderId::Gemini).unwrap_err().code(),
        "ai.unauthorized"
    );
    assert_eq!(
        wrong
            .models_with_key(ProviderId::Gemini, None)
            .unwrap_err()
            .code(),
        "ai.unauthorized"
    );
}
