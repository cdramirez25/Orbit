//! IA: el proveedor con el que Orbit responde (Claude, ChatGPT, Groq, Ollama o Docker). El usuario
//! trae SU clave o SU servidor local; Orbit no tiene servidor y nada pasa por nosotros.
//!
//! Núcleo (§4.0): solo conoce los puertos `SecretStore` (dónde se guardan las claves) y `LlmClient`
//! (cómo se habla con el proveedor); los adaptadores los elige `lib.rs`. Nunca se registra una
//! clave, una pregunta ni una respuesta.

pub mod client;
pub mod config;
#[cfg(test)]
mod live;
pub mod platform;
pub mod prompter;
pub mod providers;

use std::path::PathBuf;
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
    #[error("no se pudo usar el llavero del sistema: {0}")]
    Keychain(String),
    #[error("no se pudo conectar con el proveedor: {0}")]
    Network(String),
    #[error("el proveedor rechazó la clave")]
    Unauthorized,
    #[error("el proveedor limitó las peticiones")]
    RateLimited,
    #[error("el proveedor devolvió un error: {0}")]
    Provider(String),
    #[error("respuesta inesperada del proveedor: {0}")]
    BadResponse(String),
}

impl AiError {
    /// Código estable que la interfaz usa para elegir el mensaje (no depende del texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotConfigured => "ai.notConfigured",
            Self::MissingKey => "ai.missingKey",
            Self::MissingModel => "ai.missingModel",
            Self::Keychain(_) => "ai.keychain",
            Self::Network(_) => "ai.network",
            Self::Unauthorized => "ai.unauthorized",
            Self::RateLimited => "ai.rateLimited",
            Self::Provider(_) => "ai.provider",
            Self::BadResponse(_) => "ai.badResponse",
        }
    }
}

/// Puerto: dónde se guardan las claves de API (el llavero del sistema; en tests, memoria).
pub trait SecretStore: Send + Sync {
    fn get(&self, id: ProviderId) -> Result<Option<String>, AiError>;
    fn set(&self, id: ProviderId, secret: &str) -> Result<(), AiError>;
    /// Borrar una clave que no existe no es un error.
    fn delete(&self, id: ProviderId) -> Result<(), AiError>;
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

/// Lo que se le pide al modelo.
pub struct Request<'a> {
    pub system: &'a str,
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
    /// ¿Hay una clave guardada? La clave en sí nunca sale del llavero hacia la interfaz.
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
    config: Mutex<AiConfig>,
    config_path: PathBuf,
}

impl AiService {
    pub fn new(
        secrets: Box<dyn SecretStore>,
        client: Box<dyn LlmClient>,
        config_path: PathBuf,
    ) -> Self {
        let config = AiConfig::load(&config_path);
        Self {
            secrets,
            client,
            config: Mutex::new(config),
            config_path,
        }
    }

    fn config_guard(&self) -> MutexGuard<'_, AiConfig> {
        self.config.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn persist(&self, config: &AiConfig) {
        if let Err(error) = config.save(&self.config_path) {
            tracing::warn!(%error, "no se pudo guardar la configuración de IA");
        }
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
                    // Si el llavero falla, se muestra como "sin clave"; el error saldrá al probar.
                    has_key: id.spec().needs_key && matches!(self.secrets.get(id), Ok(Some(_))),
                }
            })
            .collect();
        AiStatus {
            active: config.active,
            providers,
        }
    }

    /// Guarda la clave (en el llavero) y el modelo y la dirección (en el JSON) de un proveedor.
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
            self.persist(&config);
        }
        Ok(self.status())
    }

    /// Elige con qué proveedor responde Orbit (`None`: ninguno).
    pub fn set_active(&self, id: Option<ProviderId>) -> AiStatus {
        {
            let mut config = self.config_guard();
            config.active = id;
            self.persist(&config);
        }
        self.status()
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

    /// Le pregunta al proveedor activo. `on_delta` recibe la respuesta por trozos y devuelve `false`
    /// para cortarla.
    pub fn ask(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
        on_delta: &mut dyn FnMut(&str) -> bool,
    ) -> Result<(), AiError> {
        let active = self.config_guard().active.ok_or(AiError::NotConfigured)?;
        let target = self.target(active, true)?;
        self.client.stream(
            &target,
            &Request {
                system,
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

    /// Llavero simulado en memoria.
    #[derive(Default)]
    pub struct FakeSecrets {
        pub map: Mutex<HashMap<ProviderId, String>>,
        pub fails: Mutex<bool>,
    }

    impl SecretStore for std::sync::Arc<FakeSecrets> {
        fn get(&self, id: ProviderId) -> Result<Option<String>, AiError> {
            if *self.fails.lock().unwrap() {
                return Err(AiError::Keychain("bloqueado".into()));
            }
            Ok(self.map.lock().unwrap().get(&id).cloned())
        }
        fn set(&self, id: ProviderId, secret: &str) -> Result<(), AiError> {
            if *self.fails.lock().unwrap() {
                return Err(AiError::Keychain("bloqueado".into()));
            }
            self.map.lock().unwrap().insert(id, secret.to_string());
            Ok(())
        }
        fn delete(&self, id: ProviderId) -> Result<(), AiError> {
            self.map.lock().unwrap().remove(&id);
            Ok(())
        }
    }

    /// Cliente simulado: devuelve los trozos de `chunks` (o el error) y apunta a quién se le habló.
    #[derive(Default)]
    pub struct FakeClient {
        pub chunks: Mutex<Vec<String>>,
        pub error: Mutex<Option<AiError>>,
        pub calls: Mutex<Vec<(Target, String, String, u32)>>,
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

    use super::testing::{FakeClient, FakeSecrets};
    use super::*;

    struct Harness {
        service: AiService,
        secrets: Arc<FakeSecrets>,
        client: Arc<FakeClient>,
        path: PathBuf,
    }

    impl Drop for Harness {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    fn harness(name: &str) -> Harness {
        let secrets = Arc::new(FakeSecrets::default());
        let client = Arc::new(FakeClient::default());
        let path =
            std::env::temp_dir().join(format!("orbit-ai-svc-{}-{name}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let service = AiService::new(
            Box::new(Arc::clone(&secrets)),
            Box::new(Arc::clone(&client)),
            path.clone(),
        );
        Harness {
            service,
            secrets,
            client,
            path,
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
        assert_eq!(status.providers.len(), 5);
        assert!(status
            .providers
            .iter()
            .all(|p| !p.has_key && p.model.is_none()));
    }

    #[test]
    fn saving_puts_the_key_in_the_keychain_and_the_model_in_the_config() {
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

        // La clave no está en el JSON de configuración ni en lo que ve la interfaz.
        let json = std::fs::read_to_string(&h.path).unwrap();
        assert!(!json.contains("gsk_secreta"), "{json}");
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
    fn the_config_survives_a_restart_but_the_key_stays_in_the_keychain() {
        let h = harness("restart");
        h.service
            .save(ProviderId::Groq, groq("gsk_x", "llama"))
            .unwrap();
        h.service.set_active(Some(ProviderId::Groq));

        let again = AiService::new(
            Box::new(Arc::clone(&h.secrets)),
            Box::new(Arc::clone(&h.client)),
            h.path.clone(),
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
                .ask("s", "u", 10, &mut ignored)
                .unwrap_err()
                .code(),
            "ai.notConfigured"
        );

        h.service
            .save(ProviderId::Groq, groq("gsk_x", "llama"))
            .unwrap();
        h.service.set_active(Some(ProviderId::Groq));
        *h.client.chunks.lock().unwrap() = vec!["Can".into(), "berra".into()];

        let mut text = String::new();
        h.service
            .ask("sistema", "¿Capital de Australia?", 100, &mut |d| {
                text.push_str(d);
                true
            })
            .unwrap();

        assert_eq!(text, "Canberra");
        let calls = h.client.calls.lock().unwrap();
        assert_eq!(
            (calls[0].1.as_str(), calls[0].2.as_str(), calls[0].3),
            ("sistema", "¿Capital de Australia?", 100)
        );
    }

    #[test]
    fn the_stream_can_be_cut_from_the_callback() {
        let h = harness("cut");
        h.service
            .save(ProviderId::Groq, groq("gsk_x", "llama"))
            .unwrap();
        h.service.set_active(Some(ProviderId::Groq));
        *h.client.chunks.lock().unwrap() = vec!["a".into(), "b".into(), "c".into()];

        let mut seen = 0;
        h.service
            .ask("s", "u", 10, &mut |_| {
                seen += 1;
                seen < 2
            })
            .unwrap();
        assert_eq!(seen, 2);
    }

    #[test]
    fn a_failing_keychain_is_an_error_and_not_a_crash() {
        let h = harness("keychain");
        *h.secrets.fails.lock().unwrap() = true;
        let error = h
            .service
            .save(ProviderId::Groq, groq("gsk_x", "m"))
            .unwrap_err();
        assert_eq!(error.code(), "ai.keychain");
        // El estado sigue funcionando: se ve como "sin clave".
        assert!(!provider(&h.service.status(), ProviderId::Groq).has_key);
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
            (AiError::Keychain("x".into()), "ai.keychain"),
            (AiError::Network("x".into()), "ai.network"),
            (AiError::Unauthorized, "ai.unauthorized"),
            (AiError::RateLimited, "ai.rateLimited"),
            (AiError::Provider("x".into()), "ai.provider"),
            (AiError::BadResponse("x".into()), "ai.badResponse"),
        ];
        for (error, code) in codes {
            assert_eq!(error.code(), code);
        }
    }
}
