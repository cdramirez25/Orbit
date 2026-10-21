//! Pruebas manuales con un proveedor real (necesitan red y una clave). Todas llevan `#[ignore]`:
//! `ORBIT_TEST_GROQ_KEY=... cargo test live_groq -- --ignored --nocapture`.
//! Imprimen lo que pasó y nunca la clave.

use std::sync::Arc;
use std::time::{Duration, Instant};

use super::client::HttpLlm;
use super::prompter::{AnsweringSink, Prompter};
use super::providers::ProviderId;
use super::testing::FakeSecrets;
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
    let path = std::env::temp_dir().join(format!("orbit-live-{}.json", std::process::id()));
    let secrets = Arc::new(FakeSecrets::default());
    let ai = Arc::new(AiService::new(
        Box::new(Arc::clone(&secrets)),
        Box::new(HttpLlm::new()),
        path.clone(),
    ));
    save_and_pick_a_model(&ai);
    ai.set_active(Some(ProviderId::Groq));

    let events = Arc::new(FakeEventSink::default());
    let sink = AnsweringSink::new(events.clone(), Prompter::new(ai, events.clone()));
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
    let _ = std::fs::remove_file(path);

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

/// Guarda la clave de verdad en el llavero de macOS y deja Groq activo en el `ai.json` de la app,
/// como lo haría la pantalla de ajustes, y comprueba que esa clave guardada funciona.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "escribe en el llavero y en la configuración reales de Orbit"]
fn live_groq_saves_the_key_in_the_real_keychain_and_config() {
    use super::platform::current::KeychainSecretStore;

    let home = std::env::var("HOME").expect("falta HOME");
    let path =
        std::path::PathBuf::from(home).join("Library/Application Support/dev.orbit.island/ai.json");
    let ai = AiService::new(
        Box::new(KeychainSecretStore),
        Box::new(HttpLlm::new()),
        path,
    );
    let model = save_and_pick_a_model(&ai);
    let status = ai.set_active(Some(ProviderId::Groq));

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
    assert!(groq.has_key, "la clave no quedó en el llavero");
    assert_eq!(groq.model.as_deref(), Some(model));
}
