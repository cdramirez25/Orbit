//! Adaptador del reloj: la hora del sistema, con la zona horaria del usuario (para los horarios).

use chrono::{Local, Timelike, Utc};

use super::Clock;

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        u64::try_from(Utc::now().timestamp_millis()).unwrap_or(0)
    }

    fn minute_of_day(&self) -> u16 {
        let now = Local::now();
        // Una hora (0 a 23) por 60 más minutos (0 a 59) siempre cabe en 16 bits.
        u16::try_from(now.hour() * 60 + now.minute()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_system_clock_gives_a_plausible_time() {
        let clock = SystemClock;
        // Después de 2024 y con los minutos del día dentro del rango.
        assert!(clock.now_ms() > 1_704_067_200_000);
        assert!(clock.minute_of_day() < 24 * 60);
    }
}
