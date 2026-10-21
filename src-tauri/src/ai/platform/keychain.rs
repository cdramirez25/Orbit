//! Claves de API en el llavero del sistema (Keychain en macOS, Administrador de credenciales en
//! Windows) con la crate `keyring`. Nada de esto toca el disco de la app ni se escribe en logs.

use keyring::{Entry, Error};

use crate::ai::providers::ProviderId;
use crate::ai::{AiError, SecretStore};

/// Nombre del servicio bajo el que se agrupan las claves de Orbit.
const SERVICE: &str = "dev.orbit.island";

pub struct KeychainSecretStore;

impl KeychainSecretStore {
    fn entry(id: ProviderId) -> Result<Entry, AiError> {
        Entry::new(SERVICE, id.account()).map_err(|error| AiError::Keychain(error.to_string()))
    }
}

impl SecretStore for KeychainSecretStore {
    fn get(&self, id: ProviderId) -> Result<Option<String>, AiError> {
        match Self::entry(id)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(AiError::Keychain(error.to_string())),
        }
    }

    fn set(&self, id: ProviderId, secret: &str) -> Result<(), AiError> {
        Self::entry(id)?
            .set_password(secret)
            .map_err(|error| AiError::Keychain(error.to_string()))
    }

    fn delete(&self, id: ProviderId) -> Result<(), AiError> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(AiError::Keychain(error.to_string())),
        }
    }
}
