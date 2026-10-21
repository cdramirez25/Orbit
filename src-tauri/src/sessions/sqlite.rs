//! Adaptador SQLite de las sesiones: viven en la base de datos local (`orbit.db`).

use rusqlite::{params, OptionalExtension, Row};

use super::{Message, Session, SessionError, SessionStore, SessionUpdate};
use crate::ai::Role;
use crate::db::Db;

pub struct SqliteSessionStore {
    db: Db,
}

impl SqliteSessionStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

fn storage(error: rusqlite::Error) -> SessionError {
    SessionError::Storage(error.to_string())
}

fn session_from(row: &Row<'_>) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        name: row.get(1)?,
        prompt: row.get(2)?,
        auto_answer: row.get::<_, i64>(3)? != 0,
        created_at: row.get(4)?,
        provider: row.get(5)?,
    })
}

const SESSION_COLUMNS: &str = "id, name, prompt, auto_answer, created_at, provider";

impl SessionStore for SqliteSessionStore {
    fn list(&self) -> Result<Vec<Session>, SessionError> {
        let connection = self.db.lock();
        let mut statement = connection
            .prepare(&format!(
                "SELECT {SESSION_COLUMNS} FROM sessions ORDER BY id DESC"
            ))
            .map_err(storage)?;
        let rows = statement.query_map([], session_from).map_err(storage)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(storage)
    }

    fn get(&self, id: i64) -> Result<Option<Session>, SessionError> {
        self.db
            .lock()
            .query_row(
                &format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE id = ?1"),
                [id],
                session_from,
            )
            .optional()
            .map_err(storage)
    }

    fn create(&self, name: &str, prompt: &str, created_at: i64) -> Result<Session, SessionError> {
        let connection = self.db.lock();
        connection
            .execute(
                "INSERT INTO sessions (name, prompt, created_at) VALUES (?1, ?2, ?3)",
                params![name, prompt, created_at],
            )
            .map_err(storage)?;
        Ok(Session {
            id: connection.last_insert_rowid(),
            name: name.to_string(),
            prompt: prompt.to_string(),
            auto_answer: false,
            created_at,
            provider: None,
        })
    }

    fn update(&self, id: i64, update: &SessionUpdate) -> Result<Session, SessionError> {
        {
            let mut connection = self.db.lock();
            let transaction = connection.transaction().map_err(storage)?;
            if let Some(name) = &update.name {
                transaction
                    .execute(
                        "UPDATE sessions SET name = ?1 WHERE id = ?2",
                        params![name, id],
                    )
                    .map_err(storage)?;
            }
            if let Some(prompt) = &update.prompt {
                transaction
                    .execute(
                        "UPDATE sessions SET prompt = ?1 WHERE id = ?2",
                        params![prompt, id],
                    )
                    .map_err(storage)?;
            }
            if let Some(auto_answer) = update.auto_answer {
                transaction
                    .execute(
                        "UPDATE sessions SET auto_answer = ?1 WHERE id = ?2",
                        params![i64::from(auto_answer), id],
                    )
                    .map_err(storage)?;
            }
            if let Some(provider) = &update.provider {
                // Una cadena vacía quita la IA propia de la sesión.
                let value = (!provider.is_empty()).then_some(provider.as_str());
                transaction
                    .execute(
                        "UPDATE sessions SET provider = ?1 WHERE id = ?2",
                        params![value, id],
                    )
                    .map_err(storage)?;
            }
            transaction.commit().map_err(storage)?;
        }
        self.get(id)?.ok_or(SessionError::NotFound)
    }

    fn delete(&self, id: i64) -> Result<(), SessionError> {
        let deleted = self
            .db
            .lock()
            .execute("DELETE FROM sessions WHERE id = ?1", [id])
            .map_err(storage)?;
        if deleted == 0 {
            Err(SessionError::NotFound)
        } else {
            Ok(())
        }
    }

    fn active(&self) -> Result<Option<i64>, SessionError> {
        self.db
            .lock()
            .query_row(
                "SELECT active_session FROM ai_state WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .map_err(storage)
    }

    fn set_active(&self, id: Option<i64>) -> Result<(), SessionError> {
        self.db
            .lock()
            .execute("UPDATE ai_state SET active_session = ?1 WHERE id = 1", [id])
            .map(|_| ())
            .map_err(storage)
    }

    fn messages(&self, session: i64) -> Result<Vec<Message>, SessionError> {
        let connection = self.db.lock();
        let mut statement = connection
            .prepare(
                "SELECT id, role, content, created_at FROM session_messages
                 WHERE session_id = ?1 ORDER BY id ASC",
            )
            .map_err(storage)?;
        let rows = statement
            .query_map([session], |row| {
                let role: String = row.get(1)?;
                Ok(Message {
                    id: row.get(0)?,
                    role: Role::parse(&role).unwrap_or(Role::User),
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })
            .map_err(storage)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(storage)
    }

    fn add_message(
        &self,
        session: i64,
        role: Role,
        content: &str,
        created_at: i64,
    ) -> Result<(), SessionError> {
        self.db
            .lock()
            .execute(
                "INSERT INTO session_messages (session_id, role, content, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![session, role.as_str(), content, created_at],
            )
            .map(|_| ())
            .map_err(storage)
    }

    fn clear_messages(&self, session: i64) -> Result<(), SessionError> {
        self.db
            .lock()
            .execute(
                "DELETE FROM session_messages WHERE session_id = ?1",
                [session],
            )
            .map(|_| ())
            .map_err(storage)
    }
}
