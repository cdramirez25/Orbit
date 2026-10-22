//! Mantener la pantalla encendida: durante un rato, en un horario diario o hasta que el usuario lo
//! apague. Mientras está activo, el sistema no apaga ni atenúa la pantalla por inactividad.
//!
//! Núcleo (§4.0): aquí viven los modos, el horario y el reloj de decisión (`KeepAwakeService`). Lo
//! que de verdad le dice al sistema operativo "no apagues la pantalla" es el puerto `ScreenKeeper`
//! (adaptador en `system.rs`) y la hora la da el puerto `Clock` (`clock.rs`); los dos los elige el
//! composition root (`lib.rs`). Así se prueba sin tocar la pantalla de nadie.
//!
//! Nada de esto sobrevive a Orbit: al cerrarse o caerse, el sistema suelta la petición y la
//! pantalla vuelve a comportarse como siempre.

pub mod clock;
pub mod system;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::events::{DomainEvent, EventSink};

/// Cada cuánto se revisa si hay que encender o soltar la petición (vence un tiempo, empieza un
/// horario…). Es una comparación de números: no cuesta nada.
const TICK_EVERY: Duration = Duration::from_secs(1);
const MINUTES_PER_DAY: u16 = 24 * 60;

/// Qué quiere el usuario. Es lo que se guarda en los ajustes y lo que ve la interfaz (espejo de
/// `src/types/awake.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum KeepAwakeSetting {
    /// La pantalla se apaga como siempre.
    #[default]
    Off,
    /// Siempre encendida, sin hora de fin: hasta que el usuario la desactive.
    Always,
    /// Encendida hasta ese instante (milisegundos Unix).
    Until { ends_at: u64 },
    /// Encendida todos los días de `start` a `end` (minutos desde la medianoche, hora local). Si
    /// `end` es menor que `start`, el horario pasa de un día al siguiente (22:00 a 02:00).
    Schedule { start: u16, end: u16 },
}

#[derive(Debug, thiserror::Error)]
pub enum KeepAwakeError {
    #[error("el sistema no dejó mantener la pantalla encendida: {0}")]
    System(String),
    #[error("el horario no es válido")]
    InvalidSchedule,
}

impl KeepAwakeError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::System(_) => "awake.system",
            Self::InvalidSchedule => "awake.invalidSchedule",
        }
    }
}

/// Lo que la interfaz ve. Espejo de `KeepAwakeStatus` en `src/types/awake.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepAwakeStatus {
    pub setting: KeepAwakeSetting,
    /// ¿Se está manteniendo la pantalla encendida ahora mismo? Con un horario puede ser que no
    /// (fuera de horas) aunque el horario esté puesto.
    pub active: bool,
    /// Código del último fallo al pedírselo al sistema (`awake.*`); `None` si no hubo.
    pub error: Option<String>,
}

/// Una petición abierta al sistema: mientras exista, la pantalla no se apaga. Al soltarla (drop),
/// el sistema vuelve a lo normal.
pub trait Hold: Send {}

/// Puerto: pedirle al sistema operativo que no apague la pantalla.
pub trait ScreenKeeper: Send + Sync {
    fn hold(&self) -> Result<Box<dyn Hold>, KeepAwakeError>;
}

/// Puerto: la hora (para los tiempos y los horarios).
pub trait Clock: Send + Sync {
    /// Milisegundos desde el 1 de enero de 1970 (UTC).
    fn now_ms(&self) -> u64;
    /// Minutos desde la medianoche, en hora local (de 0 a 1439).
    fn minute_of_day(&self) -> u16;
}

/// ¿`minute` cae dentro del horario de `start` a `end`? El fin no cuenta (de 14:00 a 17:00, a las
/// 17:00 ya terminó) y un horario con `end` menor que `start` cruza la medianoche.
fn in_window(start: u16, end: u16, minute: u16) -> bool {
    if start < end {
        (start..end).contains(&minute)
    } else {
        minute >= start || minute < end
    }
}

struct Inner {
    setting: KeepAwakeSetting,
    hold: Option<Box<dyn Hold>>,
    /// Último fallo al pedírselo al sistema. Mientras haya uno no se reintenta solo (sería un
    /// intento por segundo): el usuario vuelve a probar al cambiar el modo.
    error: Option<&'static str>,
}

pub struct KeepAwakeService {
    keeper: Box<dyn ScreenKeeper>,
    clock: Arc<dyn Clock>,
    events: Arc<dyn EventSink>,
    inner: Mutex<Inner>,
}

impl KeepAwakeService {
    /// `setting` es lo que estaba guardado: el primer `tick` lo aplica.
    pub fn new(
        keeper: Box<dyn ScreenKeeper>,
        clock: Arc<dyn Clock>,
        events: Arc<dyn EventSink>,
        setting: KeepAwakeSetting,
    ) -> Self {
        Self {
            keeper,
            clock,
            events,
            inner: Mutex::new(Inner {
                setting,
                hold: None,
                error: None,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn view(inner: &Inner) -> KeepAwakeStatus {
        KeepAwakeStatus {
            setting: inner.setting.clone(),
            active: inner.hold.is_some(),
            error: inner.error.map(str::to_owned),
        }
    }

    pub fn status(&self) -> KeepAwakeStatus {
        Self::view(&self.lock())
    }

    /// Cambia el modo (y lo aplica ya). Devuelve cómo quedó; guardarlo en los ajustes lo hace quien
    /// llama.
    pub fn set(&self, setting: KeepAwakeSetting) -> Result<KeepAwakeStatus, KeepAwakeError> {
        if let KeepAwakeSetting::Schedule { start, end } = setting {
            if start >= MINUTES_PER_DAY || end >= MINUTES_PER_DAY || start == end {
                return Err(KeepAwakeError::InvalidSchedule);
            }
        }
        let status = {
            let mut inner = self.lock();
            inner.setting = setting;
            inner.error = None;
            self.apply(&mut inner);
            Self::view(&inner)
        };
        self.events.publish(DomainEvent::KeepAwake(status.clone()));
        Ok(status)
    }

    /// Revisa si lo que se pidió sigue valiendo (se acabó el tiempo, empezó o terminó el horario) y
    /// ajusta la petición al sistema. Avisa a la interfaz solo si algo cambió.
    pub fn tick(&self) {
        let changed = {
            let mut inner = self.lock();
            let before = Self::view(&inner);
            self.apply(&mut inner);
            let after = Self::view(&inner);
            (before != after).then_some(after)
        };
        if let Some(status) = changed {
            self.events.publish(DomainEvent::KeepAwake(status));
        }
    }

    /// ¿Debería estar encendida la pantalla ahora, según el modo?
    fn wanted(&self, setting: &KeepAwakeSetting) -> bool {
        match *setting {
            KeepAwakeSetting::Off => false,
            KeepAwakeSetting::Always => true,
            KeepAwakeSetting::Until { ends_at } => self.clock.now_ms() < ends_at,
            KeepAwakeSetting::Schedule { start, end } => {
                in_window(start, end, self.clock.minute_of_day())
            }
        }
    }

    fn apply(&self, inner: &mut Inner) {
        // Un tiempo que ya venció (aunque fuera mientras Orbit estaba cerrado) deja el modo apagado.
        if let KeepAwakeSetting::Until { ends_at } = inner.setting {
            if self.clock.now_ms() >= ends_at {
                inner.setting = KeepAwakeSetting::Off;
            }
        }
        let wanted = self.wanted(&inner.setting);
        match (wanted, inner.hold.is_some()) {
            (true, false) if inner.error.is_none() => match self.keeper.hold() {
                Ok(hold) => inner.hold = Some(hold),
                Err(error) => {
                    tracing::warn!(%error, "no se pudo mantener la pantalla encendida");
                    inner.error = Some(error.code());
                }
            },
            (false, true) => inner.hold = None,
            _ => {}
        }
        if !wanted {
            inner.error = None;
        }
    }
}

/// Hilo que vigila los tiempos y los horarios mientras la app esté abierta.
pub fn spawn_ticker(service: Arc<KeepAwakeService>) {
    let spawned = thread::Builder::new()
        .name("orbit-keep-awake-ticker".into())
        .spawn(move || loop {
            service.tick();
            thread::sleep(TICK_EVERY);
        });
    if let Err(error) = spawned {
        tracing::warn!(%error, "no se pudo iniciar la vigilancia de la pantalla encendida");
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;
    use crate::events::testing::FakeEventSink;

    /// Reloj que avanza cuando el test lo dice.
    struct FakeClock {
        now_ms: Mutex<u64>,
        minute: Mutex<u16>,
    }

    impl FakeClock {
        fn new(now_ms: u64, minute: u16) -> Arc<Self> {
            Arc::new(Self {
                now_ms: Mutex::new(now_ms),
                minute: Mutex::new(minute),
            })
        }

        fn set(&self, now_ms: u64, minute: u16) {
            *self.now_ms.lock().unwrap() = now_ms;
            *self.minute.lock().unwrap() = minute;
        }
    }

    impl Clock for FakeClock {
        fn now_ms(&self) -> u64 {
            *self.now_ms.lock().unwrap()
        }
        fn minute_of_day(&self) -> u16 {
            *self.minute.lock().unwrap()
        }
    }

    /// El sistema simulado: cuenta cuántas peticiones hay abiertas y cuántas se hicieron.
    #[derive(Default)]
    struct FakeKeeper {
        open: Arc<AtomicUsize>,
        attempts: Arc<AtomicUsize>,
        fail: Arc<AtomicBool>,
    }

    struct FakeHold(Arc<AtomicUsize>);

    impl Hold for FakeHold {}

    impl Drop for FakeHold {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }

    impl ScreenKeeper for FakeKeeper {
        fn hold(&self) -> Result<Box<dyn Hold>, KeepAwakeError> {
            self.attempts.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err(KeepAwakeError::System("sin permiso".into()));
            }
            self.open.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(FakeHold(Arc::clone(&self.open))))
        }
    }

    struct Fixture {
        service: KeepAwakeService,
        clock: Arc<FakeClock>,
        events: Arc<FakeEventSink>,
        open: Arc<AtomicUsize>,
        attempts: Arc<AtomicUsize>,
        fail: Arc<AtomicBool>,
    }

    fn fixture(setting: KeepAwakeSetting, now_ms: u64, minute: u16) -> Fixture {
        let keeper = FakeKeeper::default();
        let (open, attempts, fail) = (
            Arc::clone(&keeper.open),
            Arc::clone(&keeper.attempts),
            Arc::clone(&keeper.fail),
        );
        let clock = FakeClock::new(now_ms, minute);
        let events = Arc::new(FakeEventSink::default());
        let service = KeepAwakeService::new(
            Box::new(keeper),
            Arc::clone(&clock) as Arc<dyn Clock>,
            Arc::clone(&events) as Arc<dyn EventSink>,
            setting,
        );
        Fixture {
            service,
            clock,
            events,
            open,
            attempts,
            fail,
        }
    }

    const HOUR_MS: u64 = 60 * 60 * 1000;

    fn awake_events(fx: &Fixture) -> Vec<KeepAwakeStatus> {
        fx.events
            .events()
            .into_iter()
            .filter_map(|event| match event {
                DomainEvent::KeepAwake(status) => Some(status),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn it_starts_off_and_asks_the_system_for_nothing() {
        let fx = fixture(KeepAwakeSetting::Off, 0, 0);
        fx.service.tick();
        assert_eq!(fx.open.load(Ordering::SeqCst), 0);
        assert_eq!(
            fx.service.status(),
            KeepAwakeStatus {
                setting: KeepAwakeSetting::Off,
                active: false,
                error: None
            }
        );
        assert!(awake_events(&fx).is_empty());
    }

    #[test]
    fn always_keeps_the_screen_on_until_it_is_turned_off() {
        let fx = fixture(KeepAwakeSetting::Off, 0, 0);

        let status = fx.service.set(KeepAwakeSetting::Always).unwrap();
        assert!(status.active);
        assert_eq!(fx.open.load(Ordering::SeqCst), 1);

        // Pasa el tiempo (días): sigue igual y no pide más.
        fx.clock.set(100 * HOUR_MS, 600);
        fx.service.tick();
        assert!(fx.service.status().active);
        assert_eq!(fx.attempts.load(Ordering::SeqCst), 1);

        let status = fx.service.set(KeepAwakeSetting::Off).unwrap();
        assert!(!status.active);
        assert_eq!(fx.open.load(Ordering::SeqCst), 0, "se soltó la petición");
    }

    #[test]
    fn a_duration_turns_itself_off_when_the_time_is_up() {
        let fx = fixture(KeepAwakeSetting::Off, 1_000, 0);
        fx.service
            .set(KeepAwakeSetting::Until {
                ends_at: 1_000 + 4 * HOUR_MS,
            })
            .unwrap();
        assert_eq!(fx.open.load(Ordering::SeqCst), 1);

        // A las 3 h 59 min sigue encendida.
        fx.clock.set(1_000 + 4 * HOUR_MS - 60_000, 0);
        fx.service.tick();
        assert!(fx.service.status().active);

        // A las 4 h en punto se apaga sola y el modo vuelve a "apagado".
        fx.clock.set(1_000 + 4 * HOUR_MS, 0);
        fx.service.tick();
        let status = fx.service.status();
        assert!(!status.active);
        assert_eq!(status.setting, KeepAwakeSetting::Off);
        assert_eq!(fx.open.load(Ordering::SeqCst), 0);
        assert_eq!(
            awake_events(&fx).last(),
            Some(&status),
            "la interfaz se entera"
        );
    }

    #[test]
    fn a_duration_that_expired_while_orbit_was_closed_does_nothing() {
        let fx = fixture(KeepAwakeSetting::Until { ends_at: 500 }, 10_000, 0);
        fx.service.tick();
        assert_eq!(fx.open.load(Ordering::SeqCst), 0);
        assert_eq!(fx.service.status().setting, KeepAwakeSetting::Off);
    }

    #[test]
    fn a_duration_still_running_after_a_restart_is_resumed() {
        let fx = fixture(
            KeepAwakeSetting::Until {
                ends_at: 10_000 + HOUR_MS,
            },
            10_000,
            0,
        );
        fx.service.tick();
        assert!(fx.service.status().active);
        assert_eq!(fx.open.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_saved_always_mode_is_applied_on_the_first_tick() {
        let fx = fixture(KeepAwakeSetting::Always, 0, 0);
        assert!(!fx.service.status().active, "todavía no se ha aplicado");
        fx.service.tick();
        assert!(fx.service.status().active);
    }

    #[test]
    fn a_schedule_turns_on_and_off_with_the_clock() {
        // De 14:00 (840) a 17:00 (1020).
        let fx = fixture(KeepAwakeSetting::Off, 0, 13 * 60);
        let status = fx
            .service
            .set(KeepAwakeSetting::Schedule {
                start: 840,
                end: 1020,
            })
            .unwrap();
        assert!(!status.active, "son las 13:00: todavía no");
        assert_eq!(fx.open.load(Ordering::SeqCst), 0);

        fx.clock.set(0, 840);
        fx.service.tick();
        assert!(fx.service.status().active, "a las 14:00 empieza");

        fx.clock.set(0, 1019);
        fx.service.tick();
        assert!(fx.service.status().active);

        fx.clock.set(0, 1020);
        fx.service.tick();
        let status = fx.service.status();
        assert!(!status.active, "a las 17:00 termina");
        assert_eq!(
            status.setting,
            KeepAwakeSetting::Schedule {
                start: 840,
                end: 1020
            },
            "el horario sigue puesto para mañana"
        );

        // Al día siguiente vuelve a empezar solo.
        fx.clock.set(24 * HOUR_MS, 840);
        fx.service.tick();
        assert!(fx.service.status().active);
    }

    #[test]
    fn a_schedule_can_cross_midnight() {
        assert!(in_window(22 * 60, 2 * 60, 23 * 60));
        assert!(in_window(22 * 60, 2 * 60, 0));
        assert!(in_window(22 * 60, 2 * 60, 119));
        assert!(!in_window(22 * 60, 2 * 60, 2 * 60));
        assert!(!in_window(22 * 60, 2 * 60, 12 * 60));
        assert!(in_window(840, 1020, 840));
        assert!(!in_window(840, 1020, 1020));
        assert!(!in_window(840, 1020, 839));
    }

    #[test]
    fn an_invalid_schedule_is_refused_and_nothing_changes() {
        let fx = fixture(KeepAwakeSetting::Always, 0, 0);
        fx.service.tick();

        for (start, end) in [(600, 600), (0, 1440), (1440, 60), (2000, 2001)] {
            let error = fx
                .service
                .set(KeepAwakeSetting::Schedule { start, end })
                .unwrap_err();
            assert_eq!(error.code(), "awake.invalidSchedule");
        }
        assert_eq!(fx.service.status().setting, KeepAwakeSetting::Always);
        assert!(fx.service.status().active);
    }

    #[test]
    fn switching_between_modes_never_holds_two_requests() {
        let fx = fixture(KeepAwakeSetting::Off, 0, 0);
        fx.service.set(KeepAwakeSetting::Always).unwrap();
        fx.service
            .set(KeepAwakeSetting::Until { ends_at: HOUR_MS })
            .unwrap();
        fx.service
            .set(KeepAwakeSetting::Schedule { start: 0, end: 60 })
            .unwrap();
        assert_eq!(fx.open.load(Ordering::SeqCst), 1);
        fx.service.set(KeepAwakeSetting::Off).unwrap();
        assert_eq!(fx.open.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_system_failure_is_reported_once_and_retried_only_when_asked() {
        let fx = fixture(KeepAwakeSetting::Off, 0, 0);
        fx.fail.store(true, Ordering::SeqCst);

        let status = fx.service.set(KeepAwakeSetting::Always).unwrap();
        assert!(!status.active);
        assert_eq!(status.error.as_deref(), Some("awake.system"));

        // No reintenta cada segundo.
        for _ in 0..5 {
            fx.service.tick();
        }
        assert_eq!(fx.attempts.load(Ordering::SeqCst), 1);

        // Al volver a elegir el modo, sí.
        fx.fail.store(false, Ordering::SeqCst);
        let status = fx.service.set(KeepAwakeSetting::Always).unwrap();
        assert!(status.active);
        assert_eq!(status.error, None);
        assert_eq!(fx.attempts.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn turning_it_off_clears_a_previous_failure() {
        let fx = fixture(KeepAwakeSetting::Off, 0, 0);
        fx.fail.store(true, Ordering::SeqCst);
        fx.service.set(KeepAwakeSetting::Always).unwrap();
        let status = fx.service.set(KeepAwakeSetting::Off).unwrap();
        assert_eq!(status.error, None);
    }

    #[test]
    fn the_interface_is_told_about_changes_and_not_about_every_tick() {
        let fx = fixture(KeepAwakeSetting::Off, 0, 0);
        fx.service.set(KeepAwakeSetting::Always).unwrap();
        let after_set = awake_events(&fx).len();
        assert_eq!(after_set, 1);

        for _ in 0..10 {
            fx.service.tick();
        }
        assert_eq!(awake_events(&fx).len(), after_set);
    }

    #[test]
    fn the_wire_format_matches_the_frontend() {
        let json = |setting: &KeepAwakeSetting| serde_json::to_value(setting).unwrap();
        assert_eq!(
            json(&KeepAwakeSetting::Off),
            serde_json::json!({ "mode": "off" })
        );
        assert_eq!(
            json(&KeepAwakeSetting::Always),
            serde_json::json!({ "mode": "always" })
        );
        assert_eq!(
            json(&KeepAwakeSetting::Until { ends_at: 123 }),
            serde_json::json!({ "mode": "until", "endsAt": 123 })
        );
        assert_eq!(
            json(&KeepAwakeSetting::Schedule {
                start: 840,
                end: 1020
            }),
            serde_json::json!({ "mode": "schedule", "start": 840, "end": 1020 })
        );
        assert_eq!(
            serde_json::from_str::<KeepAwakeSetting>(r#"{"mode":"until","endsAt":5}"#).unwrap(),
            KeepAwakeSetting::Until { ends_at: 5 }
        );

        let status = KeepAwakeStatus {
            setting: KeepAwakeSetting::Always,
            active: true,
            error: None,
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({
                "setting": { "mode": "always" },
                "active": true,
                "error": null
            })
        );
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(KeepAwakeError::System(String::new()).code(), "awake.system");
        assert_eq!(
            KeepAwakeError::InvalidSchedule.code(),
            "awake.invalidSchedule"
        );
    }
}
