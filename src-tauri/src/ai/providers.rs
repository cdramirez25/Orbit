//! Catálogo de proveedores de IA: qué lenguaje HTTP habla cada uno y sus valores por defecto.

use serde::{Deserialize, Serialize};

/// Los proveedores que el usuario puede configurar. Cada uno usa SU propia clave o SU propio
/// servidor: Orbit no tiene servidor ni claves propias.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ProviderId {
    #[serde(rename = "claude")]
    Claude,
    #[serde(rename = "chatgpt")]
    ChatGpt,
    #[serde(rename = "groq")]
    Groq,
    #[serde(rename = "gemini")]
    Gemini,
    #[serde(rename = "ollama")]
    Ollama,
    #[serde(rename = "docker")]
    Docker,
}

pub const ALL: [ProviderId; 6] = [
    ProviderId::Claude,
    ProviderId::ChatGpt,
    ProviderId::Groq,
    ProviderId::Gemini,
    ProviderId::Ollama,
    ProviderId::Docker,
];

/// El idioma HTTP del proveedor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wire {
    /// `POST {base}/chat/completions`, el formato de OpenAI (también Groq, Gemini, Ollama y Docker).
    OpenAi,
    /// `POST {base}/v1/messages`, el formato de Anthropic.
    Anthropic,
}

#[derive(Debug, Clone, Copy)]
pub struct ProviderSpec {
    pub wire: Wire,
    pub default_base_url: &'static str,
    /// ¿Pide clave de API? Los locales (Ollama, Docker) no.
    pub needs_key: bool,
    /// ¿El usuario puede cambiar la dirección? Solo los locales: la nube tiene la suya.
    pub editable_address: bool,
    /// Nombre del parámetro que limita la respuesta en el formato OpenAI.
    pub max_tokens_field: &'static str,
    /// Modelo que se usa si el usuario no eligió uno (uno rápido y barato del propio proveedor).
    pub default_model: Option<&'static str>,
}

impl ProviderId {
    /// El nombre estable del proveedor: el mismo de la interfaz y el que se guarda en la base.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::ChatGpt => "chatgpt",
            Self::Groq => "groq",
            Self::Gemini => "gemini",
            Self::Ollama => "ollama",
            Self::Docker => "docker",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        ALL.into_iter().find(|id| id.as_str() == text)
    }

    pub fn spec(self) -> ProviderSpec {
        match self {
            Self::Claude => ProviderSpec {
                wire: Wire::Anthropic,
                default_base_url: "https://api.anthropic.com",
                needs_key: true,
                editable_address: false,
                max_tokens_field: "max_tokens",
                default_model: Some("claude-haiku-5-5"),
            },
            Self::ChatGpt => ProviderSpec {
                wire: Wire::OpenAi,
                default_base_url: "https://api.openai.com/v1",
                needs_key: true,
                editable_address: false,
                max_tokens_field: "max_completion_tokens",
                default_model: None,
            },
            Self::Groq => ProviderSpec {
                wire: Wire::OpenAi,
                default_base_url: "https://api.groq.com/openai/v1",
                needs_key: true,
                editable_address: false,
                max_tokens_field: "max_completion_tokens",
                default_model: Some("openai/gpt-oss-20b"),
            },
            Self::Gemini => ProviderSpec {
                wire: Wire::OpenAi,
                // La capa compatible con OpenAI de la API de Gemini (Google AI Studio).
                default_base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
                needs_key: true,
                editable_address: false,
                max_tokens_field: "max_tokens",
                default_model: Some("gemini-3.5-flash-lite"),
            },
            Self::Ollama => ProviderSpec {
                wire: Wire::OpenAi,
                default_base_url: "http://localhost:11434/v1",
                needs_key: false,
                editable_address: true,
                max_tokens_field: "max_tokens",
                default_model: None,
            },
            Self::Docker => ProviderSpec {
                wire: Wire::OpenAi,
                default_base_url: "http://localhost:12434/engines/v1",
                needs_key: false,
                editable_address: true,
                max_tokens_field: "max_tokens",
                default_model: None,
            },
        }
    }

    /// La dirección que se usará de verdad: la de la nube es fija; la local, la que puso el
    /// usuario (o la de por defecto). Ollama se acepta con o sin `/v1`.
    pub fn resolve_base_url(self, saved: Option<&str>) -> String {
        let spec = self.spec();
        if !spec.editable_address {
            return spec.default_base_url.to_string();
        }
        let url = saved
            .map(str::trim)
            .unwrap_or_default()
            .trim_end_matches('/');
        if url.is_empty() {
            return spec.default_base_url.to_string();
        }
        if self == Self::Ollama && !url.ends_with("/v1") {
            return format!("{url}/v1");
        }
        url.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_use_the_names_of_the_interface() {
        assert_eq!(
            serde_json::to_string(&ProviderId::ChatGpt).unwrap(),
            "\"chatgpt\""
        );
        let id: ProviderId = serde_json::from_str("\"groq\"").unwrap();
        assert_eq!(id, ProviderId::Groq);
        let gemini: ProviderId = serde_json::from_str("\"gemini\"").unwrap();
        assert_eq!(gemini, ProviderId::Gemini);
        assert!(serde_json::from_str::<ProviderId>("\"desconocido\"").is_err());
    }

    #[test]
    fn the_stored_name_matches_the_interface_name_and_parses_back() {
        for id in ALL {
            assert_eq!(
                serde_json::to_string(&id).unwrap(),
                format!("\"{}\"", id.as_str())
            );
            assert_eq!(ProviderId::parse(id.as_str()), Some(id));
        }
        assert_eq!(ProviderId::parse("mistral"), None);
        assert_eq!(ProviderId::parse(""), None);
    }

    #[test]
    fn cloud_providers_need_a_key_and_have_a_fixed_address() {
        for id in [
            ProviderId::Claude,
            ProviderId::ChatGpt,
            ProviderId::Groq,
            ProviderId::Gemini,
        ] {
            let spec = id.spec();
            assert!(spec.needs_key && !spec.editable_address, "{id:?}");
            assert_eq!(
                id.resolve_base_url(Some("http://otro.example")),
                spec.default_base_url
            );
        }
    }

    #[test]
    fn gemini_uses_the_openai_compatible_endpoint_of_google() {
        let spec = ProviderId::Gemini.spec();
        assert_eq!(spec.wire, Wire::OpenAi);
        assert_eq!(
            spec.default_base_url,
            "https://generativelanguage.googleapis.com/v1beta/openai"
        );
        assert_eq!(spec.max_tokens_field, "max_tokens");
        assert_eq!(spec.default_model, Some("gemini-3.5-flash-lite"));
    }

    #[test]
    fn local_providers_need_no_key_and_take_the_address_of_the_user() {
        for id in [ProviderId::Ollama, ProviderId::Docker] {
            assert!(!id.spec().needs_key && id.spec().editable_address, "{id:?}");
        }
        assert_eq!(
            ProviderId::Docker.resolve_base_url(Some(" http://localhost:9000/engines/v1/ ")),
            "http://localhost:9000/engines/v1"
        );
        assert_eq!(
            ProviderId::Docker.resolve_base_url(None),
            "http://localhost:12434/engines/v1"
        );
        assert_eq!(
            ProviderId::Docker.resolve_base_url(Some("  ")),
            "http://localhost:12434/engines/v1"
        );
    }

    #[test]
    fn ollama_works_with_or_without_the_v1_suffix() {
        assert_eq!(
            ProviderId::Ollama.resolve_base_url(Some("http://localhost:11434")),
            "http://localhost:11434/v1"
        );
        assert_eq!(
            ProviderId::Ollama.resolve_base_url(Some("http://localhost:11434/v1/")),
            "http://localhost:11434/v1"
        );
    }

    #[test]
    fn groq_and_claude_have_a_default_model_and_the_rest_ask_for_one() {
        assert_eq!(
            ProviderId::Groq.spec().default_model,
            Some("openai/gpt-oss-20b")
        );
        assert!(ProviderId::Claude.spec().default_model.is_some());
        for id in [ProviderId::ChatGpt, ProviderId::Ollama, ProviderId::Docker] {
            assert_eq!(id.spec().default_model, None, "{id:?}");
        }
    }
}
