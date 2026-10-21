//! Base de datos local de Orbit: SQLite, un solo archivo (`orbit.db`) en la carpeta de datos de la
//! app. Nada sale del equipo. Aquí viven abrirla, sus permisos y las migraciones; cada módulo
//! escribe sus consultas en su propio adaptador (por ejemplo `ai/sqlite.rs`).

mod platform;

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use rusqlite::Connection;

/// Migraciones, en orden. La posición + 1 es la versión (`PRAGMA user_version`). Una migración ya
/// publicada nunca se edita: los cambios nuevos se añaden al final.
const MIGRATIONS: &[&str] = &[
    // 1: IA. Un proveedor por fila, con su clave (si la pide), dirección y modelo; y cuál está activo.
    "CREATE TABLE ai_providers (
         provider TEXT PRIMARY KEY NOT NULL,
         api_key  TEXT,
         base_url TEXT,
         model    TEXT
     );
     CREATE TABLE ai_state (
         id     INTEGER PRIMARY KEY CHECK (id = 1),
         active TEXT
     );
     INSERT INTO ai_state (id, active) VALUES (1, NULL);",
    // 2: Sesiones. Cada una con su prompt (cómo debe actuar la IA) y su historial de preguntas y
    // respuestas, que es el contexto de la IA en esa sesión. `active_session` dice cuál se usa.
    "CREATE TABLE sessions (
         id          INTEGER PRIMARY KEY AUTOINCREMENT,
         name        TEXT NOT NULL,
         prompt      TEXT NOT NULL DEFAULT '',
         auto_answer INTEGER NOT NULL DEFAULT 0,
         created_at  INTEGER NOT NULL
     );
     CREATE TABLE session_messages (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
         role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
         content    TEXT NOT NULL,
         created_at INTEGER NOT NULL
     );
     CREATE INDEX session_messages_by_session ON session_messages (session_id, id);
     ALTER TABLE ai_state ADD COLUMN active_session INTEGER;",
    // 3: Cada sesión puede usar su propia IA (NULL = la que esté activa en los ajustes).
    "ALTER TABLE sessions ADD COLUMN provider TEXT;",
];

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("no se pudo preparar el archivo de la base de datos: {0}")]
    File(#[from] std::io::Error),
    #[error("error de la base de datos: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("la base de datos es de una versión más nueva de Orbit ({found}; esta entiende hasta la {known})")]
    TooNew { found: usize, known: usize },
}

/// La conexión compartida. Se clona barato: todos los adaptadores usan la misma.
#[derive(Clone)]
pub struct Db {
    connection: Arc<Mutex<Connection>>,
}

impl Db {
    /// Abre (o crea) la base en `path`, privada para el usuario, y aplica las migraciones que falten.
    pub fn open(path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        platform::create_private_if_missing(path)?;
        Self::from_connection(Connection::open(path)?)
    }

    /// Una base en memoria (tests, o si el archivo no se puede abrir: Orbit sigue funcionando, pero
    /// lo que se guarde se pierde al cerrar).
    pub fn open_in_memory() -> Result<Self, DbError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, DbError> {
        // SQLite no hace cumplir las claves foráneas (borrar una sesión borra sus mensajes) salvo que se pida.
        connection.execute_batch("PRAGMA foreign_keys = ON")?;
        migrate(&mut connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn lock(&self) -> MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

fn migrate(connection: &mut Connection) -> Result<(), DbError> {
    let current: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let current = usize::try_from(current).unwrap_or(0);
    if current > MIGRATIONS.len() {
        return Err(DbError::TooNew {
            found: current,
            known: MIGRATIONS.len(),
        });
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let transaction = connection.transaction()?;
        transaction.execute_batch(sql)?;
        // El número va en el texto porque `PRAGMA` no admite parámetros; es un entero nuestro.
        transaction.execute_batch(&format!("PRAGMA user_version = {}", index + 1))?;
        transaction.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("orbit-db-{}-{name}.db", std::process::id()))
    }

    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn version(db: &Db) -> i64 {
        db.lock()
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap()
    }

    fn tables(db: &Db) -> Vec<String> {
        let connection = db.lock();
        let mut statement = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn a_new_database_gets_every_migration() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(version(&db), i64::try_from(MIGRATIONS.len()).unwrap());
        assert!(tables(&db).contains(&"ai_providers".to_string()));
        assert!(tables(&db).contains(&"ai_state".to_string()));
        assert!(tables(&db).contains(&"sessions".to_string()));
        assert!(tables(&db).contains(&"session_messages".to_string()));
        // La migración 3 añadió la IA propia de cada sesión.
        db.lock().prepare("SELECT provider FROM sessions").unwrap();
    }

    #[test]
    fn deleting_a_session_deletes_its_messages() {
        let db = Db::open_in_memory().unwrap();
        let connection = db.lock();
        connection
            .execute(
                "INSERT INTO sessions (id, name, created_at) VALUES (1, 's', 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO session_messages (session_id, role, content, created_at) VALUES (1, 'user', 'hola', 0)",
                [],
            )
            .unwrap();
        connection
            .execute("DELETE FROM sessions WHERE id = 1", [])
            .unwrap();

        let left: i64 = connection
            .query_row("SELECT COUNT(*) FROM session_messages", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn a_message_needs_a_known_role_and_an_existing_session() {
        let db = Db::open_in_memory().unwrap();
        let connection = db.lock();
        connection
            .execute(
                "INSERT INTO sessions (id, name, created_at) VALUES (1, 's', 0)",
                [],
            )
            .unwrap();
        let insert = |session: i64, role: &str| {
            connection.execute(
                "INSERT INTO session_messages (session_id, role, content, created_at) VALUES (?1, ?2, 'x', 0)",
                rusqlite::params![session, role],
            )
        };
        assert!(insert(1, "user").is_ok());
        assert!(insert(1, "robot").is_err());
        assert!(insert(99, "user").is_err());
    }

    #[test]
    fn opening_a_file_creates_it_and_keeps_the_data_between_runs() {
        let path = temp_path("persist");
        let _cleanup = Cleanup(path.clone());

        let db = Db::open(&path).unwrap();
        db.lock()
            .execute(
                "INSERT INTO ai_providers (provider, model) VALUES ('groq', 'm')",
                [],
            )
            .unwrap();
        drop(db);

        let again = Db::open(&path).unwrap();
        let model: String = again
            .lock()
            .query_row(
                "SELECT model FROM ai_providers WHERE provider = 'groq'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(model, "m");
        // Reabrir no repite las migraciones (no falla por "la tabla ya existe").
        assert_eq!(version(&again), i64::try_from(MIGRATIONS.len()).unwrap());
    }

    #[test]
    fn the_parent_folder_is_created() {
        let dir = std::env::temp_dir().join(format!("orbit-db-dir-{}", std::process::id()));
        let path = dir.join("datos").join("orbit.db");
        Db::open(&path).unwrap();
        assert!(path.is_file());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn only_the_owner_can_read_the_file() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_path("perms");
        let _cleanup = Cleanup(path.clone());
        Db::open(&path).unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "permisos {mode:o}");
    }

    #[test]
    fn a_database_from_a_newer_orbit_is_refused_and_a_broken_file_is_an_error() {
        let path = temp_path("newer");
        let _cleanup = Cleanup(path.clone());
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch("PRAGMA user_version = 999")
                .unwrap();
        }
        assert!(matches!(
            Db::open(&path),
            Err(DbError::TooNew { found: 999, .. })
        ));

        let broken = temp_path("broken");
        let _cleanup_broken = Cleanup(broken.clone());
        std::fs::write(
            &broken,
            "esto no es sqlite, es texto de más de cien bytes ".repeat(10),
        )
        .unwrap();
        assert!(Db::open(&broken).is_err());
    }
}
