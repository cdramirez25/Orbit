//! Datos del clima de Open-Meteo (https://open-meteo.com): sin API key. Su API gratuita es para
//! uso no comercial; si Orbit se distribuye comercialmente hay que contratar su plan de pago o
//! cambiar de proveedor (basta con otro adaptador de `WeatherProvider`). Atribución: CC BY 4.0.

use serde_json::Value;
use ureq::Agent;

use super::http::get_json;
use super::{Current, Location, Today, Units, Weather, WeatherError, WeatherProvider};

const BASE: &str = "https://api.open-meteo.com/v1/forecast";

pub struct OpenMeteo {
    agent: Agent,
}

impl OpenMeteo {
    pub fn new(agent: Agent) -> Self {
        Self { agent }
    }
}

impl WeatherProvider for OpenMeteo {
    fn fetch(&self, location: &Location, units: Units) -> Result<Weather, WeatherError> {
        parse_forecast(&get_json(&self.agent, &forecast_url(location, units))?)
    }
}

pub fn forecast_url(location: &Location, units: Units) -> String {
    let mut url = format!(
        "{BASE}?latitude={:.4}&longitude={:.4}\
         &current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day\
         &daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max\
         &timezone=auto&forecast_days=1",
        location.latitude, location.longitude
    );
    if units == Units::Imperial {
        url.push_str("&temperature_unit=fahrenheit&wind_speed_unit=mph");
    }
    url
}

fn bad(what: &str) -> WeatherError {
    WeatherError::BadResponse(format!("falta o no es válido `{what}`"))
}

fn current_number(value: &Value, key: &str) -> Result<f64, WeatherError> {
    value
        .pointer(&format!("/current/{key}"))
        .and_then(Value::as_f64)
        .ok_or_else(|| bad(&format!("current.{key}")))
}

fn first_daily(value: &Value, key: &str) -> Option<f64> {
    value
        .pointer(&format!("/daily/{key}/0"))
        .and_then(Value::as_f64)
}

/// Porcentaje 0–100 → `u8` (redondeado y acotado).
fn percent(value: f64) -> u8 {
    value.round().clamp(0.0, 100.0) as u8
}

pub fn parse_forecast(value: &Value) -> Result<Weather, WeatherError> {
    let current = Current {
        temperature: current_number(value, "temperature_2m")?,
        apparent_temperature: current_number(value, "apparent_temperature")?,
        humidity: percent(current_number(value, "relative_humidity_2m")?),
        wind_speed: current_number(value, "wind_speed_10m")?,
        weather_code: current_number(value, "weather_code")?
            .round()
            .clamp(0.0, 255.0) as u8,
        is_day: current_number(value, "is_day")? >= 0.5,
    };

    let today = Today {
        temperature_max: first_daily(value, "temperature_2m_max")
            .ok_or_else(|| bad("daily.temperature_2m_max"))?,
        temperature_min: first_daily(value, "temperature_2m_min")
            .ok_or_else(|| bad("daily.temperature_2m_min"))?,
        precipitation_probability: first_daily(value, "precipitation_probability_max").map(percent),
    };

    Ok(Weather { current, today })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// Respuesta real de Open-Meteo (recortada).
    fn real_sample() -> Value {
        json!({
            "latitude": -17.78, "longitude": -63.18, "timezone": "America/La_Paz",
            "current": {
                "time": "2026-10-21T13:30", "interval": 900,
                "temperature_2m": 28.4, "apparent_temperature": 31.2,
                "relative_humidity_2m": 62, "weather_code": 2,
                "wind_speed_10m": 14.4, "is_day": 1
            },
            "daily": {
                "time": ["2026-10-21"],
                "temperature_2m_max": [33.1], "temperature_2m_min": [21.7],
                "precipitation_probability_max": [35]
            }
        })
    }

    fn place(latitude: f64, longitude: f64) -> Location {
        Location {
            name: "X".into(),
            country: "Y".into(),
            country_code: "BO".into(),
            latitude,
            longitude,
        }
    }

    #[test]
    fn parses_a_real_response() {
        let weather = parse_forecast(&real_sample()).unwrap();
        assert_eq!(weather.current.temperature, 28.4);
        assert_eq!(weather.current.apparent_temperature, 31.2);
        assert_eq!(weather.current.humidity, 62);
        assert_eq!(weather.current.wind_speed, 14.4);
        assert_eq!(weather.current.weather_code, 2);
        assert!(weather.current.is_day);
        assert_eq!(weather.today.temperature_max, 33.1);
        assert_eq!(weather.today.temperature_min, 21.7);
        assert_eq!(weather.today.precipitation_probability, Some(35));
    }

    #[test]
    fn night_is_not_day() {
        let mut sample = real_sample();
        sample["current"]["is_day"] = json!(0);
        assert!(!parse_forecast(&sample).unwrap().current.is_day);
    }

    #[test]
    fn precipitation_probability_is_optional() {
        let mut sample = real_sample();
        sample["daily"]["precipitation_probability_max"] = json!([null]);
        assert_eq!(
            parse_forecast(&sample)
                .unwrap()
                .today
                .precipitation_probability,
            None
        );
        sample["daily"]
            .as_object_mut()
            .unwrap()
            .remove("precipitation_probability_max");
        assert_eq!(
            parse_forecast(&sample)
                .unwrap()
                .today
                .precipitation_probability,
            None
        );
    }

    #[test]
    fn integer_values_are_accepted_too() {
        let mut sample = real_sample();
        sample["current"]["temperature_2m"] = json!(30);
        assert_eq!(parse_forecast(&sample).unwrap().current.temperature, 30.0);
    }

    #[test]
    fn missing_pieces_are_an_error() {
        for pointer in [
            "/current/temperature_2m",
            "/current/weather_code",
            "/current/is_day",
            "/daily/temperature_2m_max",
        ] {
            let mut sample = real_sample();
            let (parent, key) = pointer.rsplit_once('/').unwrap();
            sample
                .pointer_mut(parent)
                .and_then(Value::as_object_mut)
                .unwrap()
                .remove(key);
            assert!(
                matches!(parse_forecast(&sample), Err(WeatherError::BadResponse(_))),
                "{pointer}"
            );
        }
        assert!(parse_forecast(&json!({})).is_err());
    }

    #[test]
    fn percentages_are_clamped() {
        assert_eq!(percent(-5.0), 0);
        assert_eq!(percent(54.6), 55);
        assert_eq!(percent(140.0), 100);
    }

    #[test]
    fn the_url_carries_the_location_and_the_fields() {
        let url = forecast_url(&place(-17.7863, -63.1812), Units::Metric);
        assert!(url.starts_with("https://api.open-meteo.com/v1/forecast?"));
        assert!(url.contains("latitude=-17.7863&longitude=-63.1812"));
        assert!(url.contains("temperature_2m,apparent_temperature,relative_humidity_2m"));
        assert!(url.contains("timezone=auto"));
        assert!(!url.contains("fahrenheit"));
    }

    #[test]
    fn imperial_units_are_requested_from_the_service() {
        let url = forecast_url(&place(40.7, -74.0), Units::Imperial);
        assert!(url.contains("temperature_unit=fahrenheit"));
        assert!(url.contains("wind_speed_unit=mph"));
    }
}
