//! Adaptador SQLite de la IA: las claves de API y la configuración de cada proveedor viven en la
//! base de datos local (`orbit.db`). Implementa a la vez `SecretStore` y `AiConfigStore`; la clave
//! y el resto comparten fila pero se leen y escriben por separado. Nunca se registra una clave.

use rusqlite::{params, OptionalExtension};

use super::config::{AiConfig, ProviderConfig};
use super::providers::ProviderId;
use super::{AiConfigStore, AiError, SecretStore};
use crate::db::Db;

pub struct SqliteAiStore {
    db: Db,
}

impl SqliteAiStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

fn storage(error: rusqlite::Error) -> AiError {
    AiError::Storage(error.to_string())
}

impl SecretStore for SqliteAiStore {
    fn get(&self, id: ProviderId) -> Result<Option<String>, AiError> {
        self.db
            .lock()
            .query_row(
                "SELECT api_key FROM ai_providers WHERE provider = ?1",
                [id.as_str()],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map(Option::flatten)
            .map_err(storage)
    }

    fn set(&self, id: ProviderId, secret: &str) -> Result<(), AiError> {
        self.db
            .lock()
            .execute(
                "INSERT INTO ai_providers (provider, api_key) VALUES (?1, ?2)
                 ON CONFLICT(provider) DO UPDATE SET api_key = excluded.api_key",
                params![id.as_str(), secret],
            )
            .map(|_| ())
            .map_err(storage)
    }

    fn delete(&self, id: ProviderId) -> Result<(), AiError> {
        self.db
            .lock()
            .execute(
                "UPDATE ai_providers SET api_key = NULL WHERE provider = ?1",
                [id.as_str()],
            )
            .map(|_| ())
            .map_err(storage)
    }
}

impl AiConfigStore for SqliteAiStore {
    fn load(&self) -> Result<AiConfig, AiError> {
        let connection = self.db.lock();
        let active: Option<String> = connection
            .query_row("SELECT active FROM ai_state WHERE id = 1", [], |row| {
                row.get(0)
            })
            .map_err(storage)?;

        let mut config = AiConfig {
            active: active.as_deref().and_then(ProviderId::parse),
            ..AiConfig::default()
        };
        let mut statement = connection
            .prepare("SELECT provider, base_url, model FROM ai_providers")
            .map_err(storage)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ProviderConfig {
                        base_url: row.get(1)?,
                        model: row.get(2)?,
                    },
                ))
            })
            .map_err(storage)?;
        for row in rows {
            let (provider, saved) = row.map_err(storage)?;
            // Un proveedor que esta versión no conoce (de una más nueva) se ignora.
            if let Some(id) = ProviderId::parse(&provider) {
                config.providers.insert(id, saved);
            }
        }
        Ok(config)
    }

    /// Guarda dirección y modelo de cada proveedor y cuál está activo. No toca las claves.
    fn save(&self, config: &AiConfig) -> Result<(), AiError> {
        let mut connection = self.db.lock();
        let transaction = connection.transaction().map_err(storage)?;
        for (id, saved) in &config.providers {
            transaction
                .execute(
                    "INSERT INTO ai_providers (provider, base_url, model) VALUES (?1, ?2, ?3)
                     ON CONFLICT(provider) DO UPDATE SET
                         base_url = excluded.base_url, model = excluded.model",
                    params![id.as_str(), saved.base_url, saved.model],
                )
                .map_err(storage)?;
        }
        transaction
            .execute(
                "UPDATE ai_state SET active = ?1 WHERE id = 1",
                [config.active.map(ProviderId::as_str)],
            )
            .map_err(storage)?;
        transaction.commit().map_err(storage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> SqliteAiStore {
        SqliteAiStore::new(Db::open_in_memory().unwrap())
    }

    #[test]
    fn an_empty_database_has_no_keys_and_an_empty_config() {
        let store = store();
        assert_eq!(store.get(ProviderId::Groq).unwrap(), None);
        assert_eq!(store.load().unwrap(), AiConfig::default());
    }

    #[test]
    fn keys_are_saved_replaced_and_deleted_per_provider() {
        let store = store();
        store.set(ProviderId::Groq, "gsk_a").unwrap();
        store.set(ProviderId::Claude, "sk-ant-b").unwrap();
        assert_eq!(
            store.get(ProviderId::Groq).unwrap().as_deref(),
            Some("gsk_a")
        );

        store.set(ProviderId::Groq, "gsk_nueva").unwrap();
        assert_eq!(
            store.get(ProviderId::Groq).unwrap().as_deref(),
            Some("gsk_nueva")
        );
        assert_eq!(
            store.get(ProviderId::Claude).unwrap().as_deref(),
            Some("sk-ant-b")
        );

        store.delete(ProviderId::Groq).unwrap();
        assert_eq!(store.get(ProviderId::Groq).unwrap(), None);
        assert_eq!(
            store.get(ProviderId::Claude).unwrap().as_deref(),
            Some("sk-ant-b")
        );
        // Borrar lo que no existe no es un error.
        store.delete(ProviderId::Groq).unwrap();
        store.delete(ProviderId::Docker).unwrap();
    }

    #[test]
    fn the_config_round_trips_with_the_active_provider() {
        let store = store();
        let mut config = AiConfig {
            active: Some(ProviderId::Ollama),
            ..AiConfig::default()
        };
        config.providers.insert(
            ProviderId::Ollama,
            ProviderConfig {
                base_url: Some("http://localhost:11434".into()),
                model: Some("llama3.2".into()),
            },
        );
        config.providers.insert(
            ProviderId::Groq,
            ProviderConfig {
                base_url: None,
                model: Some("openai/gpt-oss-20b".into()),
            },
        );
        store.save(&config).unwrap();

        assert_eq!(store.load().unwrap(), config);
    }

    #[test]
    fn saving_the_config_never_touches_the_keys_and_the_other_way_round() {
        let store = store();
        store.set(ProviderId::Groq, "gsk_a").unwrap();

        let mut config = AiConfig::default();
        config.providers.insert(
            ProviderId::Groq,
            ProviderConfig {
                base_url: None,
                model: Some("m".into()),
            },
        );
        store.save(&config).unwrap();
        assert_eq!(
            store.get(ProviderId::Groq).unwrap().as_deref(),
            Some("gsk_a")
        );

        // Cambiar o quitar la clave deja el modelo como estaba.
        store.set(ProviderId::Groq, "gsk_b").unwrap();
        store.delete(ProviderId::Groq).unwrap();
        assert_eq!(
            store
                .load()
                .unwrap()
                .provider(ProviderId::Groq)
                .model
                .as_deref(),
            Some("m")
        );
    }

    #[test]
    fn the_active_provider_can_be_cleared() {
        let store = store();
        store
            .save(&AiConfig {
                active: Some(ProviderId::Groq),
                ..AiConfig::default()
            })
            .unwrap();
        assert_eq!(store.load().unwrap().active, Some(ProviderId::Groq));

        store.save(&AiConfig::default()).unwrap();
        assert_eq!(store.load().unwrap().active, None);
    }

    #[test]
    fn a_key_is_never_part_of_the_config_that_the_service_reads() {
        let store = store();
        store.set(ProviderId::Groq, "gsk_secreta").unwrap();
        let text = format!("{:?}", store.load().unwrap());
        assert!(!text.contains("gsk_secreta"), "{text}");
    }

    #[test]
    fn providers_that_this_version_does_not_know_are_ignored() {
        let store = store();
        store
            .db
            .lock()
            .execute(
                "INSERT INTO ai_providers (provider, model) VALUES ('mistral', 'x')",
                [],
            )
            .unwrap();
        store
            .db
            .lock()
            .execute("UPDATE ai_state SET active = 'mistral' WHERE id = 1", [])
            .unwrap();

        assert_eq!(store.load().unwrap(), AiConfig::default());
    }

    #[test]
    fn the_data_survives_reopening_the_database_file() {
        let path = std::env::temp_dir().join(format!("orbit-ai-sqlite-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let store = SqliteAiStore::new(Db::open(&path).unwrap());
            store.set(ProviderId::Groq, "gsk_a").unwrap();
            store
                .save(&AiConfig {
                    active: Some(ProviderId::Groq),
                    ..AiConfig::default()
                })
                .unwrap();
        }
        let again = SqliteAiStore::new(Db::open(&path).unwrap());
        assert_eq!(
            again.get(ProviderId::Groq).unwrap().as_deref(),
            Some("gsk_a")
        );
        assert_eq!(again.load().unwrap().active, Some(ProviderId::Groq));
        std::fs::remove_file(&path).unwrap();
    }
}
