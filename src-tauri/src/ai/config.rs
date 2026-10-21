//! Lo que no es secreto de la configuración de IA (qué proveedor está activo, el modelo y la
//! dirección de cada uno). Vive en la base de datos local junto a las claves, pero se lee y se escribe
//! por separado: la configuración nunca lleva una clave.

use std::collections::BTreeMap;

use super::providers::ProviderId;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProviderConfig {
    /// Solo los proveedores locales usan una dirección propia.
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AiConfig {
    /// El proveedor con el que responde Orbit; `None` si todavía no se eligió ninguno.
    pub active: Option<ProviderId>,
    pub providers: BTreeMap<ProviderId, ProviderConfig>,
}

impl AiConfig {
    pub fn provider(&self, id: ProviderId) -> ProviderConfig {
        self.providers.get(&id).cloned().unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unconfigured_provider_reads_as_empty() {
        assert_eq!(
            AiConfig::default().provider(ProviderId::Claude),
            ProviderConfig::default()
        );
    }
}
