//! IA: el proveedor con el que Orbit responde (Claude, ChatGPT, Groq, Gemini, Ollama o Docker). El usuario
//! trae SU clave o SU servidor local; Orbit no tiene servidor y nada pasa por nosotros.
//!
//! Núcleo (§4.0): solo conoce los puertos `SecretStore` (dónde se guardan las claves), `AiConfigStore`
//! (dónde se guarda el resto) y `LlmClient` (cómo se habla con el proveedor); los adaptadores los elige `lib.rs`. Nunca se registra una
//! clave, una pregunta ni una respuesta.

pub mod client;
pub mod config;
#[cfg(test)]
mod live;
pub mod prompter;
pub mod providers;
pub mod recorder;
pub mod sqlite;

use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};

use self::config::{AiConfig, ProviderConfig};
use self::providers::{ProviderId, ALL};

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("no hay un proveedor de IA activo")]
    NotConfigured,
    #[error("falta la clave de API")]
    MissingKey,
    #[error("falta el nombre del modelo")]
    MissingModel,
    #[error("no se pudo leer o guardar la clave en este equipo: {0}")]
    Storage(String),
    #[error("no se pudo conectar con el proveedor: {0}")]
    Network(String),
    #[error("el proveedor rechazó la clave")]
    Unauthorized,
    #[error("el proveedor limitó las peticiones")]
    RateLimited,
    #[error("al proveedor no le quedan créditos")]
    NoCredits,
    #[error("el proveedor devolvió un error: {0}")]
    Provider(String),
    #[error("respuesta inesperada del proveedor: {0}")]
    BadResponse(String),
    #[error("no se oyó ninguna pregunta")]
    NoQuestion,
}

impl AiError {
    /// Código estable que la interfaz usa para elegir el mensaje (no depende del texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotConfigured => "ai.notConfigured",
            Self::MissingKey => "ai.missingKey",
            Self::MissingModel => "ai.missingModel",
            Self::Storage(_) => "ai.storage",
            Self::Network(_) => "ai.network",
            Self::Unauthorized => "ai.unauthorized",
            Self::RateLimited => "ai.rateLimited",
            Self::NoCredits => "ai.noCredits",
            Self::Provider(_) => "ai.provider",
            Self::BadResponse(_) => "ai.badResponse",
            Self::NoQuestion => "ai.noQuestion",
        }
    }
}

/// Puerto: dónde se guardan las claves de API (la base de datos local; en tests, memoria).
pub trait SecretStore: Send + Sync {
    fn get(&self, id: ProviderId) -> Result<Option<String>, AiError>;
    fn set(&self, id: ProviderId, secret: &str) -> Result<(), AiError>;
    /// Borrar una clave que no existe no es un error.
    fn delete(&self, id: ProviderId) -> Result<(), AiError>;
}

/// Puerto: dónde se guarda lo que no es secreto (proveedor activo, modelo y dirección de cada uno).
pub trait AiConfigStore: Send + Sync {
    fn load(&self) -> Result<AiConfig, AiError>;
    fn save(&self, config: &AiConfig) -> Result<(), AiError>;
}

/// A quién se le habla: proveedor, dirección, modelo y (si la pide) la clave.
#[derive(Clone)]
pub struct Target {
    pub id: ProviderId,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

// La clave no se imprime nunca, ni por error con `{:?}`.
impl std::fmt::Debug for Target {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Target")
            .field("id", &self.id)
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("api_key", &self.api_key.as_ref().map(|_| "<oculta>"))
            .finish()
    }
}

/// Quién dijo algo en una conversación con la IA.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "user" => Some(Self::User),
            "assistant" => Some(Self::Assistant),
            _ => None,
        }
    }
}

/// Un turno de la conversación (lo que ya se preguntó y se contestó en la sesión).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatTurn {
    pub role: Role,
    pub content: String,
}

/// Lo que se le pide al modelo.
pub struct Request<'a> {
    pub system: &'a str,
    /// Preguntas y respuestas anteriores, de la más antigua a la más nueva (empieza por una pregunta).
    pub history: &'a [ChatTurn],
    pub user: &'a str,
    pub max_tokens: u32,
}

/// Puerto: hablar con un proveedor de IA. La respuesta llega por trozos a `on_delta`, que devuelve
/// `false` para cortarla (por ejemplo, porque llegó una pregunta nueva).
pub trait LlmClient: Send + Sync {
    fn stream(
        &self,
        target: &Target,
        request: &Request<'_>,
        on_delta: &mut dyn FnMut(&str) -> bool,
    ) -> Result<(), AiError>;

    /// Los modelos que el proveedor ofrece a esta clave (solo los de texto). No usa `target.model`.
    fn models(&self, target: &Target) -> Result<Vec<String>, AiError>;
}

/// Lo que la interfaz guarda de un proveedor. Espejo de `AiProviderStatus` en `src/types/ai.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub id: ProviderId,
    pub base_url: Option<String>,
    pub model: Option<String>,
    /// El modelo que se usará si no se elige uno (puede no haber).
    pub default_model: Option<&'static str>,
    /// ¿Hay una clave guardada? La clave en sí nunca sale del equipo hacia la interfaz.
    pub has_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub active: Option<ProviderId>,
    pub providers: Vec<ProviderStatus>,
}

/// Lo que se cambia al guardar un proveedor. `None` = no tocar.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SaveInput {
    /// Una clave nueva. Vacía = borrar la guardada.
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

pub struct AiService {
    secrets: Box<dyn SecretStore>,
    client: Box<dyn LlmClient>,
    store: Box<dyn AiConfigStore>,
    config: Mutex<AiConfig>,
}

impl AiService {
    pub fn new(
        secrets: Box<dyn SecretStore>,
        client: Box<dyn LlmClient>,
        store: Box<dyn AiConfigStore>,
    ) -> Self {
        // Si la base no se puede leer, se arranca sin configuración: la pantalla de ajustes lo dirá.
        let config = store.load().unwrap_or_else(|error| {
            tracing::warn!(
                code = error.code(),
                "no se pudo leer la configuración de IA"
            );
            AiConfig::default()
        });
        Self {
            secrets,
            client,
            store,
            config: Mutex::new(config),
        }
    }

    fn config_guard(&self) -> MutexGuard<'_, AiConfig> {
        self.config.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn status(&self) -> AiStatus {
        let config = self.config_guard().clone();
        let providers = ALL
            .iter()
            .map(|&id| {
                let saved = config.provider(id);
                ProviderStatus {
                    id,
                    base_url: saved.base_url,
                    model: saved.model,
                    default_model: id.spec().default_model,
                    // Si la base de datos falla, se muestra como "sin clave"; el error saldrá al probar.
                    has_key: id.spec().needs_key && matches!(self.secrets.get(id), Ok(Some(_))),
                }
            })
            .collect();
        AiStatus {
            active: config.active,
            providers,
        }
    }

    /// Guarda la clave, el modelo y la dirección de un proveedor en la base de datos local.
    pub fn save(&self, id: ProviderId, input: SaveInput) -> Result<AiStatus, AiError> {
        let spec = id.spec();
        if spec.needs_key {
            if let Some(key) = input.api_key.as_deref() {
                let key = key.trim();
                if key.is_empty() {
                    self.secrets.delete(id)?;
                } else {
                    self.secrets.set(id, key)?;
                }
            }
        }

        {
            let mut config = self.config_guard();
            let mut saved = config.provider(id);
            if let Some(model) = input.model.as_deref() {
                let model = model.trim();
                saved.model = (!model.is_empty()).then(|| model.to_string());
            }
            if spec.editable_address {
                if let Some(address) = input.base_url.as_deref() {
                    let address = address.trim();
                    saved.base_url = (!address.is_empty()).then(|| address.to_string());
                }
            }
            config.providers.insert(id, saved);
            self.store.save(&config)?;
        }
        Ok(self.status())
    }

    /// Elige con qué proveedor responde Orbit (`None`: ninguno).
    pub fn set_active(&self, id: Option<ProviderId>) -> Result<AiStatus, AiError> {
        {
            let mut config = self.config_guard();
            config.active = id;
            self.store.save(&config)?;
        }
        Ok(self.status())
    }

    /// A quién se le habla. `need_model`: para listar modelos no hace falta uno elegido.
    fn target(&self, id: ProviderId, need_model: bool) -> Result<Target, AiError> {
        let spec = id.spec();
        let saved: ProviderConfig = self.config_guard().provider(id);
        let model = match saved
            .model
            .clone()
            .or(spec.default_model.map(str::to_string))
        {
            Some(model) => model,
            None if need_model => return Err(AiError::MissingModel),
            None => String::new(),
        };
        let api_key = if spec.needs_key {
            Some(self.secrets.get(id)?.ok_or(AiError::MissingKey)?)
        } else {
            None
        };
        Ok(Target {
            id,
            base_url: id.resolve_base_url(saved.base_url.as_deref()),
            model,
            api_key,
        })
    }

    /// Prueba de verdad un proveedor con una petición mínima (clave, modelo y dirección a la vez) y
    /// devuelve lo que contestó.
    pub fn test(&self, id: ProviderId) -> Result<String, AiError> {
        let target = self.target(id, true)?;
        // Holgado: un modelo que "piensa" gasta parte de este límite antes de contestar.
        let request = Request {
            system: "Reply with the single word: ok",
            history: &[],
            user: "ping",
            max_tokens: 256,
        };
        let mut reply = String::new();
        self.client.stream(&target, &request, &mut |delta| {
            reply.push_str(delta);
            true
        })?;
        Ok(reply.trim().chars().take(80).collect())
    }

    /// Los modelos que ofrece un proveedor con la clave guardada (para elegir uno en la interfaz).
    pub fn models(&self, id: ProviderId) -> Result<Vec<String>, AiError> {
        let target = self.target(id, false)?;
        let mut models = self.client.models(&target)?;
        models.sort_unstable();
        models.dedup();
        Ok(models)
    }

    /// Le pregunta a un proveedor: el que se indica (la IA propia de la sesión) o, si no, el activo de
    /// los ajustes. `on_delta` recibe la respuesta por trozos y devuelve `false` para cortarla.
    pub fn ask(
        &self,
        provider: Option<ProviderId>,
        system: &str,
        history: &[ChatTurn],
        user: &str,
        max_tokens: u32,
        on_delta: &mut dyn FnMut(&str) -> bool,
    ) -> Result<(), AiError> {
        let chosen = provider
            .or(self.config_guard().active)
            .ok_or(AiError::NotConfigured)?;
        let target = self.target(chosen, true)?;
        self.client.stream(
            &target,
            &Request {
                system,
                history,
                user,
                max_tokens,
            },
            on_delta,
        )
    }
}

#[cfg(test)]
pub mod testing {
    use std::collections::HashMap;

    use super::*;

    /// Almacén de claves simulado en memoria.
    #[derive(Default)]
    pub struct FakeSecrets {
        pub map: Mutex<HashMap<ProviderId, String>>,
        pub fails: Mutex<bool>,
    }

    impl SecretStore for std::sync::Arc<FakeSecrets> {
        fn get(&self, id: ProviderId) -> Result<Option<String>, AiError> {
            if *self.fails.lock().unwrap() {
                return Err(AiError::Storage("bloqueado".into()));
            }
            Ok(self.map.lock().unwrap().get(&id).cloned())
        }
        fn set(&self, id: ProviderId, secret: &str) -> Result<(), AiError> {
            if *self.fails.lock().unwrap() {
                return Err(AiError::Storage("bloqueado".into()));
            }
            self.map.lock().unwrap().insert(id, secret.to_string());
            Ok(())
        }
        fn delete(&self, id: ProviderId) -> Result<(), AiError> {
            self.map.lock().unwrap().remove(&id);
            Ok(())
        }
    }

    /// Almacén de configuración simulado en memoria.
    #[derive(Default)]
    pub struct FakeConfig {
        pub saved: Mutex<AiConfig>,
        pub fails: Mutex<bool>,
        pub saves: std::sync::atomic::AtomicUsize,
    }

    impl AiConfigStore for std::sync::Arc<FakeConfig> {
        fn load(&self) -> Result<AiConfig, AiError> {
            Ok(self.saved.lock().unwrap().clone())
        }
        fn save(&self, config: &AiConfig) -> Result<(), AiError> {
            if *self.fails.lock().unwrap() {
                return Err(AiError::Storage("sin espacio".into()));
            }
            *self.saved.lock().unwrap() = config.clone();
            self.saves.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }
    }

    /// Cliente simulado: devuelve los trozos de `chunks` (o el error) y apunta a quién se le habló.
    #[derive(Default)]
    pub struct FakeClient {
        pub chunks: Mutex<Vec<String>>,
        pub error: Mutex<Option<AiError>>,
        pub calls: Mutex<Vec<(Target, String, String, u32)>>,
        /// El historial que llegó en cada llamada.
        pub histories: Mutex<Vec<Vec<ChatTurn>>>,
        pub systems: Mutex<Vec<String>>,
        pub models: Mutex<Vec<String>>,
    }

    impl LlmClient for std::sync::Arc<FakeClient> {
        fn stream(
            &self,
            target: &Target,
            request: &Request<'_>,
            on_delta: &mut dyn FnMut(&str) -> bool,
        ) -> Result<(), AiError> {
            self.calls.lock().unwrap().push((
                target.clone(),
                request.system.to_string(),
                request.user.to_string(),
                request.max_tokens,
            ));
            self.histories
                .lock()
                .unwrap()
                .push(request.history.to_vec());
            self.systems
                .lock()
                .unwrap()
                .push(request.system.to_string());
            if let Some(error) = self.error.lock().unwrap().take() {
                return Err(error);
            }
            let chunks = self.chunks.lock().unwrap().clone();
            for chunk in chunks {
                if !on_delta(&chunk) {
                    break;
                }
            }
            Ok(())
        }

        fn models(&self, target: &Target) -> Result<Vec<String>, AiError> {
            self.calls
                .lock()
                .unwrap()
                .push((target.clone(), "models".into(), String::new(), 0));
            if let Some(error) = self.error.lock().unwrap().take() {
                return Err(error);
            }
            Ok(self.models.lock().unwrap().clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::testing::{FakeClient, FakeConfig, FakeSecrets};
    use super::*;

    struct Harness {
        service: AiService,
        secrets: Arc<FakeSecrets>,
        client: Arc<FakeClient>,
        config: Arc<FakeConfig>,
    }

    fn harness(_name: &str) -> Harness {
        let secrets = Arc::new(FakeSecrets::default());
        let client = Arc::new(FakeClient::default());
        let config = Arc::new(FakeConfig::default());
        let service = AiService::new(
            Box::new(Arc::clone(&secrets)),
            Box::new(Arc::clone(&client)),
            Box::new(Arc::clone(&config)),
        );
        Harness {
            service,
            secrets,
            client,
            config,
        }
    }

    fn groq(key: &str, model: &str) -> SaveInput {
        SaveInput {
            api_key: Some(key.into()),
            model: Some(model.into()),
            ..SaveInput::default()
        }
    }

    fn provider(status: &AiStatus, id: ProviderId) -> ProviderStatus {
        status
            .providers
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .unwrap()
    }

    #[test]
    fn at_first_nothing_is_configured() {
        let h = harness("empty");
        let status = h.service.status();
        assert_eq!(status.active, None);
        assert_eq!(status.providers.len(), 6);
        assert!(status
            .providers
            .iter()
            .all(|p| !p.has_key && p.model.is_none()));
    }

    #[test]
    fn saving_puts_the_key_in_the_secret_store_and_the_model_in_the_config() {
        let h = harness("save");
        let status = h
            .service
            .save(ProviderId::Groq, groq("  gsk_secreta  ", " llama "))
            .unwrap();

        let groq = provider(&status, ProviderId::Groq);
        assert!(groq.has_key);
        assert_eq!(groq.model.as_deref(), Some("llama"));
        assert_eq!(
            h.secrets
                .map
                .lock()
                .unwrap()
                .get(&ProviderId::Groq)
                .map(String::as_str),
            Some("gsk_secreta")
        );

        // La clave no está en la configuración que se guarda ni en lo que ve la interfaz.
        let saved = format!("{:?}", h.config.saved.lock().unwrap());
        assert!(!saved.contains("gsk_secreta"), "{saved}");
        assert!(!serde_json::to_string(&status)
            .unwrap()
            .contains("gsk_secreta"));
    }

    #[test]
    fn an_empty_key_removes_the_saved_one_and_no_key_leaves_it_alone() {
        let h = harness("remove");
        h.service
            .save(ProviderId::Groq, groq("gsk_x", "m"))
            .unwrap();

        let kept = h
            .service
            .save(
                ProviderId::Groq,
                SaveInput {
                    model: Some("otro".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        assert!(provider(&kept, ProviderId::Groq).has_key);
        assert_eq!(
            provider(&kept, ProviderId::Groq).model.as_deref(),
            Some("otro")
        );

        let removed = h
            .service
            .save(
                ProviderId::Groq,
                SaveInput {
                    api_key: Some("  ".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        assert!(!provider(&removed, ProviderId::Groq).has_key);
    }

    #[test]
    fn local_providers_keep_their_address_and_cloud_ones_ignore_it() {
        let h = harness("address");
        let status = h
            .service
            .save(
                ProviderId::Ollama,
                SaveInput {
                    base_url: Some(" http://localhost:11434 ".into()),
                    model: Some("llama3.2".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        assert_eq!(
            provider(&status, ProviderId::Ollama).base_url.as_deref(),
            Some("http://localhost:11434")
        );
        assert!(!provider(&status, ProviderId::Ollama).has_key);

        let status = h
            .service
            .save(
                ProviderId::Groq,
                SaveInput {
                    base_url: Some("http://malicioso".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        assert_eq!(provider(&status, ProviderId::Groq).base_url, None);
    }

    #[test]
    fn a_local_provider_never_stores_a_key() {
        let h = harness("localkey");
        h.service
            .save(
                ProviderId::Ollama,
                SaveInput {
                    api_key: Some("algo".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        assert!(h.secrets.map.lock().unwrap().is_empty());
    }

    #[test]
    fn the_config_survives_a_restart_and_the_key_stays_in_the_secret_store() {
        let h = harness("restart");
        h.service
            .save(ProviderId::Groq, groq("gsk_x", "llama"))
            .unwrap();
        h.service.set_active(Some(ProviderId::Groq)).unwrap();

        let again = AiService::new(
            Box::new(Arc::clone(&h.secrets)),
            Box::new(Arc::clone(&h.client)),
            Box::new(Arc::clone(&h.config)),
        );
        let status = again.status();
        assert_eq!(status.active, Some(ProviderId::Groq));
        assert!(provider(&status, ProviderId::Groq).has_key);
        assert_eq!(
            provider(&status, ProviderId::Groq).model.as_deref(),
            Some("llama")
        );
    }

    #[test]
    fn testing_needs_a_model_and_a_key() {
        let h = harness("needs");
        // ChatGPT no tiene modelo por defecto: hay que elegir uno.
        assert_eq!(
            h.service.test(ProviderId::ChatGpt).unwrap_err().code(),
            "ai.missingModel"
        );

        h.service
            .save(
                ProviderId::ChatGpt,
                SaveInput {
                    model: Some("m".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        assert_eq!(
            h.service.test(ProviderId::ChatGpt).unwrap_err().code(),
            "ai.missingKey"
        );

        // Ollama no pide clave: con el modelo basta.
        h.service
            .save(
                ProviderId::Ollama,
                SaveInput {
                    model: Some("llama3.2".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        *h.client.chunks.lock().unwrap() = vec!["ok".into()];
        assert_eq!(h.service.test(ProviderId::Ollama).unwrap(), "ok");
    }

    #[test]
    fn testing_talks_to_the_right_address_with_the_saved_key_and_returns_the_reply() {
        let h = harness("test");
        h.service
            .save(ProviderId::Groq, groq("gsk_x", "llama"))
            .unwrap();
        *h.client.chunks.lock().unwrap() = vec!["o".into(), "k\n".into()];

        assert_eq!(h.service.test(ProviderId::Groq).unwrap(), "ok");

        let calls = h.client.calls.lock().unwrap();
        let (target, _, user, max) = &calls[0];
        assert_eq!(target.base_url, "https://api.groq.com/openai/v1");
        assert_eq!(target.model, "llama");
        assert_eq!(target.api_key.as_deref(), Some("gsk_x"));
        assert_eq!((user.as_str(), *max), ("ping", 256));
    }

    #[test]
    fn without_a_chosen_model_the_default_one_is_used() {
        let h = harness("default");
        h.service
            .save(
                ProviderId::Groq,
                SaveInput {
                    api_key: Some("gsk_x".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        *h.client.chunks.lock().unwrap() = vec!["ok".into()];

        assert_eq!(h.service.test(ProviderId::Groq).unwrap(), "ok");
        assert_eq!(
            h.client.calls.lock().unwrap()[0].0.model,
            "openai/gpt-oss-20b"
        );
        let status = h.service.status();
        assert_eq!(
            provider(&status, ProviderId::Groq).default_model,
            Some("openai/gpt-oss-20b")
        );
        assert_eq!(provider(&status, ProviderId::Groq).model, None);
    }

    #[test]
    fn the_models_are_listed_sorted_and_without_repeats_and_need_no_chosen_model() {
        let h = harness("models");
        h.service
            .save(
                ProviderId::ChatGpt,
                SaveInput {
                    api_key: Some("sk-x".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        *h.client.models.lock().unwrap() =
            vec!["b-model".into(), "a-model".into(), "b-model".into()];

        assert_eq!(
            h.service.models(ProviderId::ChatGpt).unwrap(),
            vec!["a-model", "b-model"]
        );
        assert_eq!(h.client.calls.lock().unwrap()[0].0.model, "");
        // Sin clave no se puede preguntar.
        assert_eq!(
            h.service.models(ProviderId::Claude).unwrap_err().code(),
            "ai.missingKey"
        );
    }

    #[test]
    fn provider_errors_reach_the_caller_with_their_code() {
        let h = harness("errors");
        h.service
            .save(ProviderId::Groq, groq("gsk_x", "llama"))
            .unwrap();
        *h.client.error.lock().unwrap() = Some(AiError::Unauthorized);
        assert_eq!(
            h.service.test(ProviderId::Groq).unwrap_err().code(),
            "ai.unauthorized"
        );
    }

    #[test]
    fn asking_uses_the_active_provider_and_streams_the_chunks() {
        let h = harness("ask");
        let mut ignored = |_: &str| true;
        assert_eq!(
            h.service
                .ask(None, "s", &[], "u", 10, &mut ignored)
                .unwrap_err()
                .code(),
            "ai.notConfigured"
        );

        h.service
            .save(ProviderId::Groq, groq("gsk_x", "llama"))
            .unwrap();
        h.service.set_active(Some(ProviderId::Groq)).unwrap();
        *h.client.chunks.lock().unwrap() = vec!["Can".into(), "berra".into()];

        let mut text = String::new();
        h.service
            .ask(
                None,
                "sistema",
                &[],
                "¿Capital de Australia?",
                100,
                &mut |d| {
                    text.push_str(d);
                    true
                },
            )
            .unwrap();

        assert_eq!(text, "Canberra");
        let calls = h.client.calls.lock().unwrap();
        assert_eq!(
            (calls[0].1.as_str(), calls[0].2.as_str(), calls[0].3),
            ("sistema", "¿Capital de Australia?", 100)
        );
    }

    #[test]
    fn a_chosen_provider_is_used_instead_of_the_active_one() {
        let h = harness("chosen");
        h.service
            .save(ProviderId::Groq, groq("gsk_x", "llama"))
            .unwrap();
        h.service
            .save(
                ProviderId::Claude,
                SaveInput {
                    api_key: Some("sk-ant-x".into()),
                    ..SaveInput::default()
                },
            )
            .unwrap();
        h.service.set_active(Some(ProviderId::Groq)).unwrap();
        *h.client.chunks.lock().unwrap() = vec!["ok".into()];

        h.service
            .ask(Some(ProviderId::Claude), "s", &[], "u", 10, &mut |_| true)
            .unwrap();
        h.service
            .ask(None, "s", &[], "u", 10, &mut |_| true)
            .unwrap();

        let calls = h.client.calls.lock().unwrap();
        assert_eq!(calls[0].0.id, ProviderId::Claude);
        assert_eq!(calls[0].0.model, "claude-haiku-5-5");
        assert_eq!(calls[1].0.id, ProviderId::Groq);
    }

    #[test]
    fn a_chosen_provider_works_even_with_no_active_one_but_a_missing_key_is_an_error() {
        let h = harness("chosen2");
        h.service
            .save(ProviderId::Groq, groq("gsk_x", "llama"))
            .unwrap();
        *h.client.chunks.lock().unwrap() = vec!["ok".into()];

        // Sin proveedor activo, pero la sesión eligió uno: funciona.
        h.service
            .ask(Some(ProviderId::Groq), "s", &[], "u", 10, &mut |_| true)
            .unwrap();
        // La sesión eligió uno al que le falta la clave: error claro, no se cambia de IA en silencio.
        let error = h
            .service
            .ask(Some(ProviderId::Claude), "s", &[], "u", 10, &mut |_| true)
            .unwrap_err();
        assert_eq!(error.code(), "ai.missingKey");
    }

    #[test]
    fn the_stream_can_be_cut_from_the_callback() {
        let h = harness("cut");
        h.service
            .save(ProviderId::Groq, groq("gsk_x", "llama"))
            .unwrap();
        h.service.set_active(Some(ProviderId::Groq)).unwrap();
        *h.client.chunks.lock().unwrap() = vec!["a".into(), "b".into(), "c".into()];

        let mut seen = 0;
        h.service
            .ask(None, "s", &[], "u", 10, &mut |_| {
                seen += 1;
                seen < 2
            })
            .unwrap();
        assert_eq!(seen, 2);
    }

    #[test]
    fn a_failing_secret_store_is_an_error_and_not_a_crash() {
        let h = harness("storage");
        *h.secrets.fails.lock().unwrap() = true;
        let error = h
            .service
            .save(ProviderId::Groq, groq("gsk_x", "m"))
            .unwrap_err();
        assert_eq!(error.code(), "ai.storage");
        // El estado sigue funcionando: se ve como "sin clave".
        assert!(!provider(&h.service.status(), ProviderId::Groq).has_key);
    }

    #[test]
    fn a_failing_config_store_is_reported_when_saving_or_choosing() {
        let h = harness("configfail");
        *h.config.fails.lock().unwrap() = true;

        let error = h
            .service
            .save(ProviderId::Groq, groq("gsk_x", "m"))
            .unwrap_err();
        assert_eq!(error.code(), "ai.storage");
        assert_eq!(
            h.service
                .set_active(Some(ProviderId::Groq))
                .unwrap_err()
                .code(),
            "ai.storage"
        );
    }

    #[test]
    fn the_target_never_prints_the_key() {
        let target = Target {
            id: ProviderId::Groq,
            base_url: "https://x".into(),
            model: "m".into(),
            api_key: Some("gsk_secreta".into()),
        };
        let text = format!("{target:?}");
        assert!(!text.contains("gsk_secreta"), "{text}");
    }

    #[test]
    fn error_codes_are_stable() {
        let codes = [
            (AiError::NotConfigured, "ai.notConfigured"),
            (AiError::MissingKey, "ai.missingKey"),
            (AiError::MissingModel, "ai.missingModel"),
            (AiError::Storage("x".into()), "ai.storage"),
            (AiError::Network("x".into()), "ai.network"),
            (AiError::Unauthorized, "ai.unauthorized"),
            (AiError::RateLimited, "ai.rateLimited"),
            (AiError::Provider("x".into()), "ai.provider"),
            (AiError::BadResponse("x".into()), "ai.badResponse"),
            (AiError::NoQuestion, "ai.noQuestion"),
        ];
        for (error, code) in codes {
            assert_eq!(error.code(), code);
        }
    }
}
