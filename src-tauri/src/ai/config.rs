//! Lo que no es secreto de la configuración de IA (qué proveedor está activo, el modelo y la
//! dirección de cada uno). Va en un JSON aparte; las claves NUNCA van aquí, sino en el llavero.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::providers::ProviderId;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderConfig {
    /// Solo los proveedores locales usan una dirección propia.
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiConfig {
    /// El proveedor con el que responde Orbit; `None` si todavía no se eligió ninguno.
    pub active: Option<ProviderId>,
    pub providers: BTreeMap<ProviderId, ProviderConfig>,
}

impl AiConfig {
    /// Lee el archivo; si no existe o está dañado, la configuración vacía.
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self).map_err(io::Error::other)?;
        fs::write(path, json)
    }

    pub fn provider(&self, id: ProviderId) -> ProviderConfig {
        self.providers.get(&id).cloned().unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("orbit-ai-{}-{name}.json", std::process::id()))
    }

    #[test]
    fn a_missing_or_broken_file_gives_an_empty_config() {
        let missing = temp_path("missing");
        assert_eq!(AiConfig::load(&missing), AiConfig::default());

        let broken = temp_path("broken");
        fs::write(&broken, "{ no es json").unwrap();
        assert_eq!(AiConfig::load(&broken), AiConfig::default());
        fs::remove_file(&broken).unwrap();
    }

    #[test]
    fn it_survives_a_round_trip_and_uses_the_names_of_the_interface() {
        let path = temp_path("roundtrip");
        let mut config = AiConfig {
            active: Some(ProviderId::Groq),
            ..AiConfig::default()
        };
        config.providers.insert(
            ProviderId::Ollama,
            ProviderConfig {
                base_url: Some("http://localhost:11434".into()),
                model: Some("llama3.2".into()),
            },
        );
        config.save(&path).unwrap();

        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"active\": \"groq\""), "{text}");
        assert!(text.contains("\"baseUrl\""), "{text}");
        assert_eq!(AiConfig::load(&path), config);
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn an_unconfigured_provider_reads_as_empty() {
        assert_eq!(
            AiConfig::default().provider(ProviderId::Claude),
            ProviderConfig::default()
        );
    }
}
