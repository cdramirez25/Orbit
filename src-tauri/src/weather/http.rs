//! Cliente HTTP compartido por los adaptadores del clima. Usa el TLS del sistema operativo
//! (Secure Transport en macOS, SChannel en Windows) y sus certificados.

use std::time::Duration;

use serde_json::Value;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::Agent;

use super::WeatherError;

const TIMEOUT: Duration = Duration::from_secs(10);
const USER_AGENT: &str = concat!("Orbit/", env!("CARGO_PKG_VERSION"));

pub fn agent() -> Agent {
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    let config = Agent::config_builder()
        .tls_config(tls)
        .timeout_global(Some(TIMEOUT))
        .user_agent(USER_AGENT)
        .build();
    Agent::new_with_config(config)
}

/// GET que devuelve el cuerpo como JSON. Un error de red o un estado 4xx/5xx es `Network`;
/// un cuerpo que no es JSON, `BadResponse`.
pub fn get_json(agent: &Agent, url: &str) -> Result<Value, WeatherError> {
    let mut response = agent
        .get(url)
        .call()
        .map_err(|error| WeatherError::Network(error.to_string()))?;
    response
        .body_mut()
        .read_json::<Value>()
        .map_err(|error| WeatherError::BadResponse(error.to_string()))
}
