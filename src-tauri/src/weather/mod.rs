//! Clima de la zona del usuario (módulo Clima de la isla).
//!
//! Núcleo: tipos, puertos y `WeatherService` (con caché). Los adaptadores que usan Internet son
//! `ip_locator` (ubicación aproximada por IP) y `open_meteo` (datos del clima); se eligen en el
//! composition root, así que cambiar de proveedor no toca nada de este archivo.

pub mod http;
pub mod ip_locator;
pub mod open_meteo;

use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// El clima se considera fresco durante este tiempo; pasado, se vuelve a pedir.
const FRESH_FOR: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, thiserror::Error)]
pub enum WeatherError {
    #[error("sin conexión o el servicio no respondió: {0}")]
    Network(String),
    #[error("respuesta inesperada del servicio: {0}")]
    BadResponse(String),
}

impl WeatherError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Network(_) => "weather.network",
            Self::BadResponse(_) => "weather.badResponse",
        }
    }
}

/// Lugar para el que se pide el clima.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub name: String,
    pub country: String,
    pub country_code: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Units {
    /// °C y km/h.
    Metric,
    /// °F y mph.
    Imperial,
}

impl Units {
    /// Unidades habituales del país (código ISO de dos letras).
    pub fn for_country(country_code: &str) -> Self {
        match country_code.to_ascii_uppercase().as_str() {
            "US" | "LR" | "MM" => Self::Imperial,
            _ => Self::Metric,
        }
    }
}

/// Condiciones de ahora mismo. Los valores ya vienen en las unidades pedidas.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Current {
    pub temperature: f64,
    pub apparent_temperature: f64,
    /// Humedad relativa, 0–100.
    pub humidity: u8,
    pub wind_speed: f64,
    /// Código meteorológico WMO (0 despejado, 61 lluvia, 95 tormenta…).
    pub weather_code: u8,
    pub is_day: bool,
}

/// Resumen del día de hoy.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Today {
    pub temperature_max: f64,
    pub temperature_min: f64,
    /// Probabilidad máxima de precipitación, 0–100 (si el proveedor la da).
    pub precipitation_probability: Option<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Weather {
    pub current: Current,
    pub today: Today,
}

/// Lo que recibe la interfaz.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherReport {
    pub location: Location,
    pub units: Units,
    pub current: Current,
    pub today: Today,
    /// Cuándo se obtuvo (milisegundos Unix).
    pub fetched_at_ms: u64,
}

/// Puerto: dónde está el usuario (aproximadamente).
pub trait LocationProvider: Send + Sync {
    fn locate(&self) -> Result<Location, WeatherError>;
}

/// Puerto: de dónde salen los datos del clima.
pub trait WeatherProvider: Send + Sync {
    fn fetch(&self, location: &Location, units: Units) -> Result<Weather, WeatherError>;
}

#[derive(Default)]
struct Cache {
    location: Option<Location>,
    report: Option<(Instant, WeatherReport)>,
}

/// Obtiene el clima de la zona del usuario y lo guarda un rato para no pedirlo a cada rato.
/// La ubicación se detecta una sola vez por sesión y no se guarda en disco.
pub struct WeatherService {
    locator: Box<dyn LocationProvider>,
    provider: Box<dyn WeatherProvider>,
    cache: Mutex<Cache>,
}

impl WeatherService {
    pub fn new(locator: Box<dyn LocationProvider>, provider: Box<dyn WeatherProvider>) -> Self {
        Self {
            locator,
            provider,
            cache: Mutex::new(Cache::default()),
        }
    }

    /// Clima actual. Con `force` se salta la caché.
    pub fn get(&self, force: bool) -> Result<WeatherReport, WeatherError> {
        let unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(0));
        self.get_at(force, Instant::now(), unix_ms)
    }

    fn get_at(
        &self,
        force: bool,
        now: Instant,
        unix_ms: u64,
    ) -> Result<WeatherReport, WeatherError> {
        let mut cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);

        if !force {
            if let Some((fetched, report)) = &cache.report {
                if now.saturating_duration_since(*fetched) < FRESH_FOR {
                    return Ok(report.clone());
                }
            }
        }

        let location = match &cache.location {
            Some(location) => location.clone(),
            None => {
                let location = self.locator.locate()?;
                cache.location = Some(location.clone());
                location
            }
        };

        let units = Units::for_country(&location.country_code);
        let weather = self.provider.fetch(&location, units)?;
        let report = WeatherReport {
            location,
            units,
            current: weather.current,
            today: weather.today,
            fetched_at_ms: unix_ms,
        };
        cache.report = Some((now, report.clone()));
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    use super::*;

    fn santa_cruz() -> Location {
        Location {
            name: "Santa Cruz de la Sierra".into(),
            country: "Bolivia".into(),
            country_code: "BO".into(),
            latitude: -17.78,
            longitude: -63.18,
        }
    }

    fn sample_weather(temperature: f64) -> Weather {
        Weather {
            current: Current {
                temperature,
                apparent_temperature: temperature + 1.5,
                humidity: 60,
                wind_speed: 12.0,
                weather_code: 2,
                is_day: true,
            },
            today: Today {
                temperature_max: temperature + 6.0,
                temperature_min: temperature - 5.0,
                precipitation_probability: Some(20),
            },
        }
    }

    struct FakeLocator {
        calls: Arc<AtomicUsize>,
        location: Location,
        fail: Arc<AtomicBool>,
    }

    impl LocationProvider for FakeLocator {
        fn locate(&self) -> Result<Location, WeatherError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err(WeatherError::Network("sin red".into()));
            }
            Ok(self.location.clone())
        }
    }

    struct FakeProvider {
        calls: Arc<AtomicUsize>,
        units_seen: Arc<Mutex<Vec<Units>>>,
        fail: Arc<AtomicBool>,
    }

    impl WeatherProvider for FakeProvider {
        fn fetch(&self, _: &Location, units: Units) -> Result<Weather, WeatherError> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            self.units_seen.lock().unwrap().push(units);
            if self.fail.load(Ordering::SeqCst) {
                return Err(WeatherError::Network("sin red".into()));
            }
            Ok(sample_weather(20.0 + call as f64))
        }
    }

    struct Harness {
        service: WeatherService,
        locate_calls: Arc<AtomicUsize>,
        fetch_calls: Arc<AtomicUsize>,
        units_seen: Arc<Mutex<Vec<Units>>>,
        locate_fails: Arc<AtomicBool>,
        fetch_fails: Arc<AtomicBool>,
    }

    fn harness(location: Location) -> Harness {
        let locate_calls = Arc::new(AtomicUsize::new(0));
        let fetch_calls = Arc::new(AtomicUsize::new(0));
        let units_seen = Arc::new(Mutex::new(Vec::new()));
        let locate_fails = Arc::new(AtomicBool::new(false));
        let fetch_fails = Arc::new(AtomicBool::new(false));
        let service = WeatherService::new(
            Box::new(FakeLocator {
                calls: Arc::clone(&locate_calls),
                location,
                fail: Arc::clone(&locate_fails),
            }),
            Box::new(FakeProvider {
                calls: Arc::clone(&fetch_calls),
                units_seen: Arc::clone(&units_seen),
                fail: Arc::clone(&fetch_fails),
            }),
        );
        Harness {
            service,
            locate_calls,
            fetch_calls,
            units_seen,
            locate_fails,
            fetch_fails,
        }
    }

    #[test]
    fn the_first_call_locates_the_user_and_fetches_the_weather() {
        let h = harness(santa_cruz());
        let report = h.service.get_at(false, Instant::now(), 1_000).unwrap();

        assert_eq!(report.location.name, "Santa Cruz de la Sierra");
        assert_eq!(report.units, Units::Metric);
        assert_eq!(report.current.temperature, 20.0);
        assert_eq!(report.fetched_at_ms, 1_000);
        assert_eq!(h.locate_calls.load(Ordering::SeqCst), 1);
        assert_eq!(h.fetch_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_fresh_report_comes_from_the_cache() {
        let h = harness(santa_cruz());
        let now = Instant::now();
        let first = h.service.get_at(false, now, 1).unwrap();
        let second = h
            .service
            .get_at(false, now + Duration::from_secs(60), 2)
            .unwrap();

        assert_eq!(first, second);
        assert_eq!(h.fetch_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_stale_report_is_fetched_again_without_locating_again() {
        let h = harness(santa_cruz());
        let now = Instant::now();
        h.service.get_at(false, now, 1).unwrap();
        let later = h
            .service
            .get_at(false, now + FRESH_FOR + Duration::from_secs(1), 2)
            .unwrap();

        assert_eq!(later.current.temperature, 21.0); // segunda petición
        assert_eq!(later.fetched_at_ms, 2);
        assert_eq!(h.fetch_calls.load(Ordering::SeqCst), 2);
        assert_eq!(h.locate_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn force_skips_the_cache() {
        let h = harness(santa_cruz());
        let now = Instant::now();
        h.service.get_at(false, now, 1).unwrap();
        h.service.get_at(true, now, 2).unwrap();
        assert_eq!(h.fetch_calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_failed_location_is_retried_on_the_next_call() {
        let h = harness(santa_cruz());
        h.locate_fails.store(true, Ordering::SeqCst);
        let now = Instant::now();
        assert!(matches!(
            h.service.get_at(false, now, 1),
            Err(WeatherError::Network(_))
        ));
        assert_eq!(h.fetch_calls.load(Ordering::SeqCst), 0);

        h.locate_fails.store(false, Ordering::SeqCst);
        assert!(h.service.get_at(false, now, 2).is_ok());
        assert_eq!(h.locate_calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_failed_fetch_keeps_the_previous_report_in_the_cache() {
        let h = harness(santa_cruz());
        let now = Instant::now();
        let good = h.service.get_at(false, now, 1).unwrap();

        h.fetch_fails.store(true, Ordering::SeqCst);
        assert!(h.service.get_at(true, now, 2).is_err());

        // Sin red, una petición normal dentro de la ventana de frescura sigue sirviendo el último clima.
        let cached = h
            .service
            .get_at(false, now + Duration::from_secs(30), 3)
            .unwrap();
        assert_eq!(cached, good);
    }

    #[test]
    fn units_follow_the_country() {
        assert_eq!(Units::for_country("BO"), Units::Metric);
        assert_eq!(Units::for_country("es"), Units::Metric);
        assert_eq!(Units::for_country("US"), Units::Imperial);
        assert_eq!(Units::for_country("us"), Units::Imperial);
        assert_eq!(Units::for_country(""), Units::Metric);

        let usa = Location {
            country_code: "US".into(),
            ..santa_cruz()
        };
        let h = harness(usa);
        let report = h.service.get_at(false, Instant::now(), 1).unwrap();
        assert_eq!(report.units, Units::Imperial);
        assert_eq!(*h.units_seen.lock().unwrap(), vec![Units::Imperial]);
    }

    #[test]
    fn the_wire_format_matches_the_frontend() {
        let h = harness(santa_cruz());
        let report = h.service.get_at(false, Instant::now(), 42).unwrap();
        let json = serde_json::to_value(&report).unwrap();

        assert_eq!(json["location"]["countryCode"], "BO");
        assert_eq!(json["units"], "metric");
        assert_eq!(json["current"]["apparentTemperature"], 21.5);
        assert_eq!(json["current"]["weatherCode"], 2);
        assert_eq!(json["current"]["isDay"], true);
        assert_eq!(json["today"]["temperatureMax"], 26.0);
        assert_eq!(json["today"]["precipitationProbability"], 20);
        assert_eq!(json["fetchedAtMs"], 42);
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(WeatherError::Network("x".into()).code(), "weather.network");
        assert_eq!(
            WeatherError::BadResponse("x".into()).code(),
            "weather.badResponse"
        );
    }

    /// Prueba contra Internet de verdad (ubicación por IP + Open-Meteo). Se ejecuta a mano:
    /// `cargo test live_weather -- --ignored --nocapture`.
    #[test]
    #[ignore = "usa la red"]
    fn live_weather_for_the_current_location() {
        let agent = super::http::agent();
        let service = WeatherService::new(
            Box::new(super::ip_locator::IpLocator::new(agent.clone())),
            Box::new(super::open_meteo::OpenMeteo::new(agent)),
        );
        let report = service.get(true).expect("clima real");
        println!(
            "{} ({}): {:.1} grados, sensación {:.1}, humedad {} %, viento {:.1}, código {}, máx {:.1}, mín {:.1}",
            report.location.name,
            report.location.country_code,
            report.current.temperature,
            report.current.apparent_temperature,
            report.current.humidity,
            report.current.wind_speed,
            report.current.weather_code,
            report.today.temperature_max,
            report.today.temperature_min,
        );
        assert!(report.current.temperature > -90.0 && report.current.temperature < 60.0);
    }
}
