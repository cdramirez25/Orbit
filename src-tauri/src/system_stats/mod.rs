//! El estado del equipo: batería (solo en portátiles), uso de CPU, memoria y velocidad de la red. Lo
//! lee el módulo Equipo de la isla mientras está a la vista.
//!
//! Núcleo (§4.0): aquí viven los tipos y la cuenta de las velocidades (`SystemStatsService`); lo que de
//! verdad habla con el sistema operativo son los puertos `SystemProbe` (CPU, memoria y red) y
//! `BatteryProbe` (batería), más `Clock` para medir el tiempo entre lecturas. Sus adaptadores los elige
//! el composition root (`lib.rs`).

pub mod battery;
pub mod platform;
pub mod sysinfo_probe;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

pub use self::battery::Battery;

/// Si se pide el estado dos veces en menos que esto se devuelve el de la vez anterior: con tan poco
/// tiempo el uso de CPU y las velocidades salen casi al azar.
const MIN_INTERVAL: Duration = Duration::from_millis(250);

/// Lo que mide el sistema en un momento. Los contadores de la red son totales desde que arrancó el
/// equipo: la velocidad sale de comparar dos lecturas.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reading {
    /// Uso de CPU desde la lectura anterior, de 0 a 100 (entre todos los núcleos).
    pub cpu_percent: f32,
    pub cpu_cores: usize,
    pub memory_used: u64,
    pub memory_total: u64,
    /// Bytes recibidos y enviados desde siempre (sin la red local ni las interfaces virtuales).
    pub received_total: u64,
    pub sent_total: u64,
}

/// Puerto: lo que el sistema sabe de su CPU, su memoria y su red.
pub trait SystemProbe: Send {
    fn read(&mut self) -> Reading;
}

/// Puerto: la batería del equipo. `None` si no tiene (un equipo de escritorio).
pub trait BatteryProbe: Send + Sync {
    fn read(&self) -> Option<Battery>;
}

/// Puerto: un reloj que solo avanza, para medir el tiempo entre dos lecturas.
pub trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}

/// Espejo de `SystemStats` en `src/types/system.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu: CpuUsage,
    pub memory: MemoryUsage,
    pub network: NetworkSpeed,
    /// `None` en un equipo sin batería: la interfaz no muestra esa tarjeta.
    pub battery: Option<Battery>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuUsage {
    /// De 0 a 100.
    pub percent: f32,
    pub cores: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUsage {
    /// Bytes.
    pub used: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSpeed {
    /// Bytes por segundo.
    pub down_per_sec: u64,
    pub up_per_sec: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum SystemStatsError {
    #[error("no se pudo leer el estado del equipo: {0}")]
    Read(String),
}

impl SystemStatsError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Read(_) => "system.read",
        }
    }
}

/// La lectura anterior: sirve de punto de partida para las velocidades.
struct Previous {
    at: Instant,
    received_total: u64,
    sent_total: u64,
    /// Lo que se devolvió entonces (por si se vuelve a pedir enseguida).
    stats: Option<SystemStats>,
}

struct Inner {
    probe: Box<dyn SystemProbe>,
    previous: Previous,
}

pub struct SystemStatsService {
    inner: Mutex<Inner>,
    battery: Box<dyn BatteryProbe>,
    clock: Box<dyn Clock>,
}

impl SystemStatsService {
    /// Hace una primera lectura para tener con qué comparar la siguiente.
    pub fn new(
        mut probe: Box<dyn SystemProbe>,
        battery: Box<dyn BatteryProbe>,
        clock: Box<dyn Clock>,
    ) -> Self {
        let first = probe.read();
        let previous = Previous {
            at: clock.now(),
            received_total: first.received_total,
            sent_total: first.sent_total,
            stats: None,
        };
        Self {
            inner: Mutex::new(Inner { probe, previous }),
            battery,
            clock,
        }
    }

    /// El estado del equipo ahora. La CPU y las velocidades son lo ocurrido desde la última vez que se
    /// pidió, así que conviene pedirlo con regularidad (cada segundo, más o menos).
    pub fn snapshot(&self) -> SystemStats {
        let mut guard = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let inner = &mut *guard;
        let now = self.clock.now();
        let elapsed = now.saturating_duration_since(inner.previous.at);

        if elapsed < MIN_INTERVAL {
            if let Some(stats) = &inner.previous.stats {
                return stats.clone();
            }
        }

        let reading = inner.probe.read();
        let seconds = elapsed.as_secs_f64().max(f64::EPSILON);
        let stats = SystemStats {
            cpu: CpuUsage {
                percent: reading.cpu_percent.clamp(0.0, 100.0),
                cores: reading.cpu_cores,
            },
            memory: MemoryUsage {
                used: reading.memory_used.min(reading.memory_total),
                total: reading.memory_total,
            },
            network: NetworkSpeed {
                down_per_sec: per_second(
                    reading
                        .received_total
                        .saturating_sub(inner.previous.received_total),
                    seconds,
                ),
                up_per_sec: per_second(
                    reading.sent_total.saturating_sub(inner.previous.sent_total),
                    seconds,
                ),
            },
            battery: self.battery.read(),
        };
        inner.previous = Previous {
            at: now,
            received_total: reading.received_total,
            sent_total: reading.sent_total,
            stats: Some(stats.clone()),
        };
        stats
    }
}

fn per_second(bytes: u64, seconds: f64) -> u64 {
    // El contador no llega a 2^53 bytes: la conversión a decimal no pierde nada que importe.
    (bytes as f64 / seconds).round() as u64
}

/// Adaptador: el reloj del sistema.
pub struct MonotonicClock;

impl Clock for MonotonicClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Arc;

    use super::battery::BatteryState;
    use super::*;

    struct FakeProbe(VecDeque<Reading>);

    impl SystemProbe for FakeProbe {
        fn read(&mut self) -> Reading {
            // La última lectura se repite si se piden más de las preparadas.
            if self.0.len() > 1 {
                self.0.pop_front().unwrap_or_else(|| reading(0, 0))
            } else {
                self.0.front().copied().unwrap_or_else(|| reading(0, 0))
            }
        }
    }

    struct FakeClock {
        start: Instant,
        offset_ms: Mutex<u64>,
    }

    impl FakeClock {
        fn advance(&self, ms: u64) {
            *self.offset_ms.lock().unwrap() += ms;
        }
    }

    impl Clock for Arc<FakeClock> {
        fn now(&self) -> Instant {
            self.start + Duration::from_millis(*self.offset_ms.lock().unwrap())
        }
    }

    struct FakeBattery(Option<Battery>);

    impl BatteryProbe for FakeBattery {
        fn read(&self) -> Option<Battery> {
            self.0
        }
    }

    fn reading(received_total: u64, sent_total: u64) -> Reading {
        Reading {
            cpu_percent: 12.5,
            cpu_cores: 8,
            memory_used: 4 << 30,
            memory_total: 16 << 30,
            received_total,
            sent_total,
        }
    }

    fn service(
        readings: Vec<Reading>,
        battery: Option<Battery>,
    ) -> (SystemStatsService, Arc<FakeClock>) {
        let clock = Arc::new(FakeClock {
            start: Instant::now(),
            offset_ms: Mutex::new(0),
        });
        let service = SystemStatsService::new(
            Box::new(FakeProbe(readings.into())),
            Box::new(FakeBattery(battery)),
            Box::new(Arc::clone(&clock)),
        );
        (service, clock)
    }

    #[test]
    fn the_speed_is_what_moved_since_the_last_time_per_second() {
        let (service, clock) = service(
            vec![
                reading(1_000, 500),
                reading(3_000, 800),
                reading(3_000, 800),
            ],
            None,
        );
        clock.advance(1_000);

        let stats = service.snapshot();
        assert_eq!(stats.network.down_per_sec, 2_000);
        assert_eq!(stats.network.up_per_sec, 300);
    }

    #[test]
    fn the_speed_follows_the_time_that_really_passed() {
        let (service, clock) = service(vec![reading(0, 0), reading(3_000, 1_500)], None);
        clock.advance(2_000);

        let stats = service.snapshot();
        assert_eq!(stats.network.down_per_sec, 1_500);
        assert_eq!(stats.network.up_per_sec, 750);
    }

    #[test]
    fn each_speed_is_measured_against_the_reading_before_it() {
        let (service, clock) = service(
            vec![reading(0, 0), reading(1_000, 0), reading(1_000, 0)],
            None,
        );
        clock.advance(1_000);
        assert_eq!(service.snapshot().network.down_per_sec, 1_000);

        clock.advance(1_000);
        assert_eq!(service.snapshot().network.down_per_sec, 0);
    }

    #[test]
    fn a_counter_that_goes_back_is_not_a_negative_speed() {
        let (service, clock) = service(vec![reading(9_000, 9_000), reading(100, 50)], None);
        clock.advance(1_000);

        let stats = service.snapshot();
        assert_eq!(stats.network.down_per_sec, 0);
        assert_eq!(stats.network.up_per_sec, 0);
    }

    #[test]
    fn asking_again_right_away_gives_the_same_answer_without_reading() {
        let (service, clock) = service(
            vec![reading(0, 0), reading(1_000, 0), reading(9_999_999, 0)],
            None,
        );
        clock.advance(1_000);
        let first = service.snapshot();

        clock.advance(50);
        assert_eq!(service.snapshot(), first);

        clock.advance(1_000);
        assert_ne!(service.snapshot(), first);
    }

    #[test]
    fn the_cpu_and_the_memory_are_kept_inside_their_limits() {
        let mut wild = reading(0, 0);
        wild.cpu_percent = 340.0;
        wild.memory_used = 20 << 30;
        let (service, clock) = service(vec![reading(0, 0), wild], None);
        clock.advance(1_000);

        let stats = service.snapshot();
        assert_eq!(stats.cpu.percent, 100.0);
        assert_eq!(stats.cpu.cores, 8);
        assert_eq!(stats.memory.used, 16 << 30);
        assert_eq!(stats.memory.total, 16 << 30);
    }

    #[test]
    fn the_battery_is_there_only_when_the_computer_has_one() {
        let battery = Battery {
            percent: 80,
            state: BatteryState::Charging,
            minutes_left: Some(35),
        };
        let (laptop, clock) = service(vec![reading(0, 0)], Some(battery));
        clock.advance(1_000);
        assert_eq!(laptop.snapshot().battery, Some(battery));

        let (desktop, clock) = service(vec![reading(0, 0)], None);
        clock.advance(1_000);
        assert_eq!(desktop.snapshot().battery, None);
    }

    #[test]
    fn it_is_sent_to_the_interface_with_camel_case_names() {
        let (service, clock) = service(vec![reading(0, 0)], None);
        clock.advance(1_000);

        let json = serde_json::to_value(service.snapshot()).unwrap();
        assert_eq!(json["cpu"]["cores"], 8);
        assert_eq!(json["memory"]["total"], 16u64 << 30);
        assert_eq!(json["network"]["downPerSec"], 0);
        assert!(json["battery"].is_null());
    }

    /// El estado real de este equipo con los adaptadores de verdad: dos lecturas con un segundo entre
    /// ellas. Manual: mientras corre, genera tráfico (por ejemplo, una descarga) para ver la red.
    ///
    /// ```text
    /// cargo test live_reads_this_computer -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "lee el equipo de verdad"]
    fn live_reads_this_computer() {
        let service = SystemStatsService::new(
            Box::new(sysinfo_probe::SysinfoProbe::new()),
            Box::new(platform::SystemBattery),
            Box::new(MonotonicClock),
        );
        for _ in 0..4 {
            std::thread::sleep(Duration::from_secs(1));
            println!("{:?}", service.snapshot());
        }
    }
}
