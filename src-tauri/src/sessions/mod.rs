//! Sesiones: cada una tiene su propio prompt (cómo debe actuar la IA) y su historial de preguntas y
//! respuestas, que es el contexto de la IA en esa sesión. Una sesión está activa a la vez.
//!
//! Núcleo (§4.0): solo conoce el puerto `SessionStore`; el adaptador SQLite lo elige `lib.rs`.
//! Nunca se registra una pregunta, una respuesta ni un prompt.

pub mod sqlite;

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::ai::providers::ProviderId;
use crate::ai::{ChatTurn, Role};

/// Tope del historial que se manda a la IA en cada pregunta (≈ 4 000 tokens). Se descartan las
/// preguntas más antiguas primero; el prompt de la sesión nunca se recorta.
pub const MAX_CONTEXT_CHARS: usize = 16_000;
/// Tope del prompt de una sesión.
pub const MAX_PROMPT_CHARS: usize = 4_000;
const MAX_NAME_CHARS: usize = 80;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("la sesión no existe")]
    NotFound,
    #[error("la sesión necesita un nombre")]
    EmptyName,
    #[error("esa IA no existe")]
    UnknownProvider,
    #[error("error al guardar la sesión: {0}")]
    Storage(String),
}

impl SessionError {
    /// Código estable que la interfaz usa para elegir el mensaje (no depende del texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound => "session.notFound",
            Self::EmptyName => "session.emptyName",
            Self::UnknownProvider => "session.unknownProvider",
            Self::Storage(_) => "session.storage",
        }
    }
}

/// Espejo de `Session` en `src/types/sessions.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: i64,
    pub name: String,
    /// Instrucciones para la IA de esta sesión ("responde como un experto en…").
    pub prompt: String,
    /// ¿Contesta sola las preguntas que oiga? Por defecto no: se le pregunta con el botón.
    pub auto_answer: bool,
    /// La IA de esta sesión (`claude`, `groq`…); `None` = la que esté activa en los ajustes.
    pub provider: Option<String>,
    /// Segundos Unix.
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: i64,
    pub role: Role,
    pub content: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsState {
    pub active: Option<i64>,
    /// De la más nueva a la más antigua.
    pub sessions: Vec<Session>,
}

/// Lo que se cambia de una sesión. `None` = no tocar.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionUpdate {
    pub name: Option<String>,
    pub prompt: Option<String>,
    pub auto_answer: Option<bool>,
    /// La IA de la sesión; una cadena vacía la quita (vuelve a usar la activa de los ajustes).
    pub provider: Option<String>,
}

/// Puerto: dónde viven las sesiones (la base de datos local; en tests, memoria).
pub trait SessionStore: Send + Sync {
    /// De la más nueva a la más antigua.
    fn list(&self) -> Result<Vec<Session>, SessionError>;
    fn get(&self, id: i64) -> Result<Option<Session>, SessionError>;
    fn create(&self, name: &str, prompt: &str, created_at: i64) -> Result<Session, SessionError>;
    /// `NotFound` si no existe. Los campos ya vienen validados.
    fn update(&self, id: i64, update: &SessionUpdate) -> Result<Session, SessionError>;
    fn delete(&self, id: i64) -> Result<(), SessionError>;
    fn active(&self) -> Result<Option<i64>, SessionError>;
    fn set_active(&self, id: Option<i64>) -> Result<(), SessionError>;
    /// De la más antigua a la más nueva.
    fn messages(&self, session: i64) -> Result<Vec<Message>, SessionError>;
    fn add_message(
        &self,
        session: i64,
        role: Role,
        content: &str,
        created_at: i64,
    ) -> Result<(), SessionError>;
    fn clear_messages(&self, session: i64) -> Result<(), SessionError>;
}

/// Todo lo que la IA necesita saber de la sesión activa para contestar una pregunta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Context {
    pub session: i64,
    /// Instrucciones de la sesión (vacío si no puso ninguna).
    pub prompt: String,
    /// Las preguntas y respuestas anteriores, de la más antigua a la más nueva.
    pub history: Vec<ChatTurn>,
    pub auto_answer: bool,
    /// La IA propia de la sesión; `None` = la activa de los ajustes.
    pub provider: Option<ProviderId>,
}

pub struct SessionService {
    store: Box<dyn SessionStore>,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| i64::try_from(elapsed.as_secs()).unwrap_or(0))
}

fn clean_name(name: &str) -> Result<String, SessionError> {
    let name: String = name.trim().chars().take(MAX_NAME_CHARS).collect();
    if name.is_empty() {
        Err(SessionError::EmptyName)
    } else {
        Ok(name)
    }
}

/// `""` = sin IA propia; si no, tiene que ser una IA que Orbit conozca.
fn clean_provider(provider: &str) -> Result<String, SessionError> {
    let provider = provider.trim();
    if provider.is_empty() || ProviderId::parse(provider).is_some() {
        Ok(provider.to_string())
    } else {
        Err(SessionError::UnknownProvider)
    }
}

fn clean_prompt(prompt: &str) -> String {
    prompt.trim().chars().take(MAX_PROMPT_CHARS).collect()
}

impl SessionService {
    pub fn new(store: Box<dyn SessionStore>) -> Self {
        Self { store }
    }

    pub fn state(&self) -> Result<SessionsState, SessionError> {
        let mut active = self.store.active()?;
        let sessions = self.store.list()?;
        // Si la activa ya no existe (por ejemplo, se borró a mano), no hay ninguna activa.
        if active.is_some_and(|id| !sessions.iter().any(|s| s.id == id)) {
            active = None;
        }
        Ok(SessionsState { active, sessions })
    }

    /// Crea una sesión y la deja activa: lo normal es empezar a usarla enseguida.
    pub fn create(&self, name: &str, prompt: &str) -> Result<SessionsState, SessionError> {
        let session = self
            .store
            .create(&clean_name(name)?, &clean_prompt(prompt), now())?;
        self.store.set_active(Some(session.id))?;
        self.state()
    }

    pub fn update(&self, id: i64, update: SessionUpdate) -> Result<SessionsState, SessionError> {
        let update = SessionUpdate {
            name: update.name.as_deref().map(clean_name).transpose()?,
            prompt: update.prompt.as_deref().map(clean_prompt),
            auto_answer: update.auto_answer,
            provider: update.provider.as_deref().map(clean_provider).transpose()?,
        };
        self.store.update(id, &update)?;
        self.state()
    }

    /// Borra la sesión con su historial. Si era la activa, pasa a serlo la más nueva que quede.
    pub fn delete(&self, id: i64) -> Result<SessionsState, SessionError> {
        let was_active = self.store.active()? == Some(id);
        self.store.delete(id)?;
        if was_active {
            let next = self.store.list()?.first().map(|session| session.id);
            self.store.set_active(next)?;
        }
        self.state()
    }

    pub fn set_active(&self, id: Option<i64>) -> Result<SessionsState, SessionError> {
        if let Some(id) = id {
            self.store.get(id)?.ok_or(SessionError::NotFound)?;
        }
        self.store.set_active(id)?;
        self.state()
    }

    pub fn messages(&self, session: i64) -> Result<Vec<Message>, SessionError> {
        self.store.messages(session)
    }

    pub fn clear_messages(&self, session: i64) -> Result<(), SessionError> {
        self.store.get(session)?.ok_or(SessionError::NotFound)?;
        self.store.clear_messages(session)
    }

    /// El contexto de la sesión activa (`None` si no hay ninguna): su prompt y el historial más
    /// reciente que cabe en `MAX_CONTEXT_CHARS`, siempre empezando por una pregunta.
    pub fn context(&self) -> Result<Option<Context>, SessionError> {
        let Some(id) = self.state()?.active else {
            return Ok(None);
        };
        let Some(session) = self.store.get(id)? else {
            return Ok(None);
        };

        let mut budget = MAX_CONTEXT_CHARS;
        let mut recent: Vec<ChatTurn> = Vec::new();
        for message in self.store.messages(id)?.into_iter().rev() {
            let cost = message.content.chars().count();
            if cost > budget {
                break;
            }
            budget -= cost;
            recent.push(ChatTurn {
                role: message.role,
                content: message.content,
            });
        }
        recent.reverse();
        // Anthropic exige empezar por el usuario: si el recorte dejó una respuesta suelta, se quita.
        while recent
            .first()
            .is_some_and(|turn| turn.role == Role::Assistant)
        {
            recent.remove(0);
        }
        Ok(Some(Context {
            session: id,
            prompt: session.prompt,
            history: recent,
            auto_answer: session.auto_answer,
            provider: session.provider.as_deref().and_then(ProviderId::parse),
        }))
    }

    /// Apunta una pregunta y su respuesta en la sesión (solo cuando la respuesta salió bien).
    pub fn record_exchange(
        &self,
        session: i64,
        question: &str,
        answer: &str,
    ) -> Result<(), SessionError> {
        let at = now();
        self.store.add_message(session, Role::User, question, at)?;
        self.store.add_message(session, Role::Assistant, answer, at)
    }

    /// ¿La sesión activa contesta sola las preguntas que oiga?
    pub fn auto_answer(&self) -> bool {
        self.context()
            .ok()
            .flatten()
            .is_some_and(|context| context.auto_answer)
    }
}

#[cfg(test)]
pub mod testing {
    use super::*;
    use crate::db::Db;

    /// Servicio de verdad sobre una base SQLite en memoria: así los tests ejercitan el SQL.
    pub fn service() -> SessionService {
        let db = Db::open_in_memory().unwrap();
        SessionService::new(Box::new(super::sqlite::SqliteSessionStore::new(db)))
    }
}

#[cfg(test)]
mod tests {
    use super::testing::service;
    use super::*;

    fn names(state: &SessionsState) -> Vec<&str> {
        state.sessions.iter().map(|s| s.name.as_str()).collect()
    }

    #[test]
    fn at_first_there_are_no_sessions_and_none_is_active() {
        let state = service().state().unwrap();
        assert_eq!(state.active, None);
        assert!(state.sessions.is_empty());
        assert_eq!(service().context().unwrap(), None);
    }

    #[test]
    fn creating_a_session_activates_it_and_the_newest_comes_first() {
        let sessions = service();
        sessions.create("Primera", "").unwrap();
        let state = sessions.create("  Segunda  ", "Responde corto").unwrap();

        assert_eq!(names(&state), vec!["Segunda", "Primera"]);
        assert_eq!(state.active, Some(state.sessions[0].id));
        assert_eq!(state.sessions[0].prompt, "Responde corto");
        assert!(!state.sessions[0].auto_answer);
    }

    #[test]
    fn a_session_needs_a_name_and_the_prompt_is_trimmed_and_capped() {
        let sessions = service();
        assert_eq!(
            sessions.create("   ", "x").unwrap_err().code(),
            "session.emptyName"
        );

        let state = sessions
            .create(
                &"n".repeat(500),
                &format!("  {}  ", "p".repeat(MAX_PROMPT_CHARS + 100)),
            )
            .unwrap();
        assert_eq!(state.sessions[0].name.chars().count(), 80);
        assert_eq!(state.sessions[0].prompt.chars().count(), MAX_PROMPT_CHARS);
    }

    #[test]
    fn updating_changes_only_what_is_given() {
        let sessions = service();
        let id = sessions.create("A", "prompt viejo").unwrap().sessions[0].id;

        let state = sessions
            .update(
                id,
                SessionUpdate {
                    prompt: Some("nuevo".into()),
                    ..SessionUpdate::default()
                },
            )
            .unwrap();
        assert_eq!(
            (
                state.sessions[0].name.as_str(),
                state.sessions[0].prompt.as_str()
            ),
            ("A", "nuevo")
        );

        let state = sessions
            .update(
                id,
                SessionUpdate {
                    name: Some(" B ".into()),
                    auto_answer: Some(true),
                    ..SessionUpdate::default()
                },
            )
            .unwrap();
        assert_eq!(state.sessions[0].name, "B");
        assert!(state.sessions[0].auto_answer);
        assert_eq!(state.sessions[0].prompt, "nuevo");

        assert_eq!(
            sessions
                .update(
                    id,
                    SessionUpdate {
                        name: Some(" ".into()),
                        ..SessionUpdate::default()
                    }
                )
                .unwrap_err()
                .code(),
            "session.emptyName"
        );
        assert_eq!(
            sessions
                .update(999, SessionUpdate::default())
                .unwrap_err()
                .code(),
            "session.notFound"
        );
    }

    #[test]
    fn a_session_can_have_its_own_ai_and_go_back_to_the_default_one() {
        let sessions = service();
        let id = sessions.create("A", "").unwrap().sessions[0].id;
        assert_eq!(sessions.state().unwrap().sessions[0].provider, None);
        assert_eq!(sessions.context().unwrap().unwrap().provider, None);

        let state = sessions
            .update(
                id,
                SessionUpdate {
                    provider: Some(" groq ".into()),
                    ..SessionUpdate::default()
                },
            )
            .unwrap();
        assert_eq!(state.sessions[0].provider.as_deref(), Some("groq"));
        assert_eq!(
            sessions.context().unwrap().unwrap().provider,
            Some(ProviderId::Groq)
        );

        // Cambiar otra cosa no toca la IA de la sesión.
        sessions
            .update(
                id,
                SessionUpdate {
                    prompt: Some("x".into()),
                    ..SessionUpdate::default()
                },
            )
            .unwrap();
        assert_eq!(
            sessions.context().unwrap().unwrap().provider,
            Some(ProviderId::Groq)
        );

        // Una cadena vacía la quita.
        let state = sessions
            .update(
                id,
                SessionUpdate {
                    provider: Some(String::new()),
                    ..SessionUpdate::default()
                },
            )
            .unwrap();
        assert_eq!(state.sessions[0].provider, None);
        assert_eq!(sessions.context().unwrap().unwrap().provider, None);
    }

    #[test]
    fn an_unknown_ai_is_refused() {
        let sessions = service();
        let id = sessions.create("A", "").unwrap().sessions[0].id;
        let error = sessions
            .update(
                id,
                SessionUpdate {
                    provider: Some("mistral".into()),
                    ..SessionUpdate::default()
                },
            )
            .unwrap_err();
        assert_eq!(error.code(), "session.unknownProvider");
        assert_eq!(sessions.state().unwrap().sessions[0].provider, None);
    }

    #[test]
    fn switching_the_active_session_checks_that_it_exists() {
        let sessions = service();
        let first = sessions.create("A", "").unwrap().sessions[0].id;
        sessions.create("B", "").unwrap();

        assert_eq!(
            sessions.set_active(Some(first)).unwrap().active,
            Some(first)
        );
        assert_eq!(sessions.set_active(None).unwrap().active, None);
        assert_eq!(
            sessions.set_active(Some(999)).unwrap_err().code(),
            "session.notFound"
        );
    }

    #[test]
    fn deleting_the_active_session_activates_the_newest_that_remains() {
        let sessions = service();
        let a = sessions.create("A", "").unwrap().sessions[0].id;
        let b = sessions.create("B", "").unwrap().sessions[0].id;
        let c = sessions.create("C", "").unwrap().sessions[0].id;

        // Borrar una que no es la activa no cambia la activa.
        assert_eq!(sessions.delete(a).unwrap().active, Some(c));
        // Borrar la activa pasa a la más nueva que queda.
        let state = sessions.delete(c).unwrap();
        assert_eq!(state.active, Some(b));
        assert_eq!(names(&state), vec!["B"]);
        // Sin sesiones no hay activa.
        assert_eq!(sessions.delete(b).unwrap().active, None);
    }

    #[test]
    fn the_context_carries_the_prompt_and_the_history_in_order() {
        let sessions = service();
        let id = sessions.create("A", "Eres un tutor").unwrap().sessions[0].id;
        sessions
            .record_exchange(id, "¿Capital de Francia?", "París.")
            .unwrap();
        sessions
            .record_exchange(id, "¿Y de Italia?", "Roma.")
            .unwrap();

        let context = sessions.context().unwrap().unwrap();
        assert_eq!(context.session, id);
        assert_eq!(context.prompt, "Eres un tutor");
        let turns: Vec<(Role, &str)> = context
            .history
            .iter()
            .map(|t| (t.role, t.content.as_str()))
            .collect();
        assert_eq!(
            turns,
            vec![
                (Role::User, "¿Capital de Francia?"),
                (Role::Assistant, "París."),
                (Role::User, "¿Y de Italia?"),
                (Role::Assistant, "Roma."),
            ]
        );
    }

    #[test]
    fn each_session_keeps_its_own_history() {
        let sessions = service();
        let a = sessions.create("A", "").unwrap().sessions[0].id;
        sessions
            .record_exchange(a, "pregunta de A", "respuesta de A")
            .unwrap();
        let b = sessions.create("B", "").unwrap().sessions[0].id;

        assert!(sessions.context().unwrap().unwrap().history.is_empty());
        assert_eq!(sessions.messages(a).unwrap().len(), 2);
        assert!(sessions.messages(b).unwrap().is_empty());
    }

    #[test]
    fn the_history_is_cut_from_the_oldest_and_always_starts_with_a_question() {
        let sessions = service();
        let id = sessions.create("A", "").unwrap().sessions[0].id;
        let big = "x".repeat(MAX_CONTEXT_CHARS / 2 + 10);
        sessions.record_exchange(id, &big, "r1").unwrap(); // se sale del tope
        sessions.record_exchange(id, &big, "r2").unwrap();
        sessions.record_exchange(id, "última", "r3").unwrap();

        let history = sessions.context().unwrap().unwrap().history;
        assert_eq!(history.first().map(|t| t.role), Some(Role::User));
        assert_eq!(history.last().map(|t| t.content.as_str()), Some("r3"));
        let total: usize = history.iter().map(|t| t.content.chars().count()).sum();
        assert!(total <= MAX_CONTEXT_CHARS, "{total}");
        assert!(history.len() < 6, "no se recortó nada");
    }

    #[test]
    fn clearing_the_history_keeps_the_session_and_its_prompt() {
        let sessions = service();
        let id = sessions.create("A", "mi prompt").unwrap().sessions[0].id;
        sessions.record_exchange(id, "p", "r").unwrap();

        sessions.clear_messages(id).unwrap();

        assert!(sessions.messages(id).unwrap().is_empty());
        assert_eq!(sessions.context().unwrap().unwrap().prompt, "mi prompt");
        assert_eq!(
            sessions.clear_messages(999).unwrap_err().code(),
            "session.notFound"
        );
    }

    #[test]
    fn auto_answer_is_off_until_the_session_turns_it_on() {
        let sessions = service();
        assert!(
            !sessions.auto_answer(),
            "sin sesión no hay respuesta automática"
        );
        let id = sessions.create("A", "").unwrap().sessions[0].id;
        assert!(!sessions.auto_answer());

        sessions
            .update(
                id,
                SessionUpdate {
                    auto_answer: Some(true),
                    ..SessionUpdate::default()
                },
            )
            .unwrap();
        assert!(sessions.auto_answer());
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(SessionError::NotFound.code(), "session.notFound");
        assert_eq!(SessionError::EmptyName.code(), "session.emptyName");
        assert_eq!(
            SessionError::UnknownProvider.code(),
            "session.unknownProvider"
        );
        assert_eq!(SessionError::Storage("x".into()).code(), "session.storage");
    }
}
