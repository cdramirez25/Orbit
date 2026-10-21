//! Ubicación aproximada (ciudad) a partir de la IP, con ipwho.is. Solo se envía la petición
//! normal de red (tu IP es lo único que el servicio ve); no se manda ningún dato de Orbit.
//! Para otro proveedor basta con otro adaptador de `LocationProvider`.

use serde_json::Value;
use ureq::Agent;

use super::http::get_json;
use super::{Location, LocationProvider, WeatherError};

const URL: &str =
    "https://ipwho.is/?fields=success,message,city,region,country,country_code,latitude,longitude";

pub struct IpLocator {
    agent: Agent,
}

impl IpLocator {
    pub fn new(agent: Agent) -> Self {
        Self { agent }
    }
}

impl LocationProvider for IpLocator {
    fn locate(&self) -> Result<Location, WeatherError> {
        parse_location(&get_json(&self.agent, URL)?)
    }
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

/// Respuesta de ipwho.is → `Location`. Sin ciudad se usa la región y, si no, el país.
pub fn parse_location(value: &Value) -> Result<Location, WeatherError> {
    if value.get("success").and_then(Value::as_bool) != Some(true) {
        let reason = text(value, "message").unwrap_or("el servicio no pudo ubicarte");
        return Err(WeatherError::BadResponse(reason.to_string()));
    }

    let number = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_f64)
            .ok_or_else(|| WeatherError::BadResponse(format!("falta `{key}`")))
    };
    let latitude = number("latitude")?;
    let longitude = number("longitude")?;

    let country = text(value, "country").unwrap_or_default().to_string();
    let name = text(value, "city")
        .or_else(|| text(value, "region"))
        .unwrap_or(&country)
        .to_string();
    if name.is_empty() {
        return Err(WeatherError::BadResponse("sin nombre de lugar".to_string()));
    }

    Ok(Location {
        name,
        country,
        country_code: text(value, "country_code").unwrap_or_default().to_string(),
        latitude,
        longitude,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_a_city_level_answer() {
        let location = parse_location(&json!({
            "success": true,
            "country": "Bolivia",
            "country_code": "BO",
            "region": "Departamento de Santa Cruz",
            "city": "Santa Cruz de la Sierra",
            "latitude": -17.7862874,
            "longitude": -63.1811713
        }))
        .unwrap();

        assert_eq!(location.name, "Santa Cruz de la Sierra");
        assert_eq!(location.country, "Bolivia");
        assert_eq!(location.country_code, "BO");
        assert!((location.latitude + 17.786).abs() < 0.001);
        assert!((location.longitude + 63.181).abs() < 0.001);
    }

    #[test]
    fn falls_back_to_region_then_country() {
        let no_city = parse_location(&json!({
            "success": true, "country": "Bolivia", "country_code": "BO",
            "region": "Santa Cruz", "city": "", "latitude": -17.0, "longitude": -63.0
        }))
        .unwrap();
        assert_eq!(no_city.name, "Santa Cruz");

        let only_country = parse_location(&json!({
            "success": true, "country": "Bolivia", "country_code": "BO",
            "latitude": -17.0, "longitude": -65.0
        }))
        .unwrap();
        assert_eq!(only_country.name, "Bolivia");
    }

    #[test]
    fn a_failed_lookup_reports_the_service_message() {
        let error =
            parse_location(&json!({ "success": false, "message": "Reserved range" })).unwrap_err();
        assert!(
            matches!(&error, WeatherError::BadResponse(message) if message == "Reserved range")
        );
    }

    #[test]
    fn missing_coordinates_are_an_error() {
        assert!(parse_location(&json!({ "success": true, "city": "X" })).is_err());
    }

    #[test]
    fn a_nameless_place_is_an_error() {
        assert!(
            parse_location(&json!({ "success": true, "latitude": 1.0, "longitude": 2.0 })).is_err()
        );
    }
}
