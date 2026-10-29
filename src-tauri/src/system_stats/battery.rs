//! La batería: el tipo que ve la interfaz y la forma de traducir lo que dice cada sistema operativo.
//! Las dos traducciones son funciones puras (sin llamar al sistema) para poder probarlas en
//! cualquier equipo; quien lee de verdad es `platform/`.

use serde::Serialize;

/// Qué está pasando con la batería.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BatteryState {
    /// Conectado a la corriente y cargando.
    Charging,
    /// Funcionando con la batería.
    Discharging,
    /// Conectado y ya llena.
    Full,
    /// Conectado a la corriente pero sin cargar (por ejemplo, con un límite de carga).
    PluggedIn,
}

/// Espejo de `Battery` en `src/types/system.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    /// De 0 a 100.
    pub percent: u8,
    pub state: BatteryState,
    /// Minutos que faltan para vaciarse (`Discharging`) o para llenarse (`Charging`), si el sistema
    /// lo sabe.
    pub minutes_left: Option<u32>,
}

/// Lo que dice macOS de una fuente de energía (`IOPSGetPowerSourceDescription`).
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MacPower {
    pub current: i64,
    pub max: i64,
    pub charging: bool,
    pub charged: bool,
    pub on_ac: bool,
    /// Minutos para vaciarse o llenarse; negativo mientras el sistema aún lo calcula.
    pub minutes: i64,
}

#[cfg(any(target_os = "macos", test))]
pub fn from_mac(power: MacPower) -> Option<Battery> {
    if power.max <= 0 {
        return None;
    }
    let percent = (power.current.saturating_mul(100) / power.max).clamp(0, 100) as u8;
    let state = if power.charging {
        BatteryState::Charging
    } else if power.on_ac {
        if power.charged || percent >= 100 {
            BatteryState::Full
        } else {
            BatteryState::PluggedIn
        }
    } else {
        BatteryState::Discharging
    };
    // Sin corriente enchufada y sin cargar no hay un tiempo que dar, salvo el de vaciarse.
    let minutes_left = match state {
        BatteryState::Charging | BatteryState::Discharging => u32::try_from(power.minutes).ok(),
        BatteryState::Full | BatteryState::PluggedIn => None,
    };
    Some(Battery {
        percent,
        state,
        minutes_left,
    })
}

/// `SYSTEM_POWER_STATUS.BatteryFlag`: este bit dice que el equipo no tiene batería.
#[cfg(any(target_os = "windows", test))]
const WINDOWS_NO_BATTERY: u8 = 128;
/// `BatteryFlag`: se está cargando.
#[cfg(any(target_os = "windows", test))]
const WINDOWS_CHARGING: u8 = 8;
/// `BatteryFlag` cuando Windows no sabe el estado de la batería.
#[cfg(any(target_os = "windows", test))]
const WINDOWS_UNKNOWN_FLAG: u8 = 255;
/// `BatteryLifePercent` cuando Windows no lo sabe.
#[cfg(any(target_os = "windows", test))]
const WINDOWS_UNKNOWN_PERCENT: u8 = 255;
/// `BatteryLifeTime` cuando Windows no lo sabe.
#[cfg(any(target_os = "windows", test))]
const WINDOWS_UNKNOWN_SECONDS: u32 = u32::MAX;

/// Lo que dice Windows (`GetSystemPowerStatus`): si está enchufado (`ac_line` 1), las marcas de la
/// batería, el porcentaje y los segundos que le quedan.
#[cfg(any(target_os = "windows", test))]
pub fn from_windows(ac_line: u8, flag: u8, percent: u8, seconds: u32) -> Option<Battery> {
    if flag & WINDOWS_NO_BATTERY != 0 || flag == WINDOWS_UNKNOWN_FLAG {
        return None;
    }
    if percent == WINDOWS_UNKNOWN_PERCENT {
        return None;
    }
    let percent = percent.min(100);
    let state = if flag & WINDOWS_CHARGING != 0 {
        BatteryState::Charging
    } else if ac_line == 1 {
        if percent >= 100 {
            BatteryState::Full
        } else {
            BatteryState::PluggedIn
        }
    } else {
        BatteryState::Discharging
    };
    // Windows solo da el tiempo que queda con la batería; cuánto falta para llenarla no.
    let minutes_left = match state {
        BatteryState::Discharging if seconds != WINDOWS_UNKNOWN_SECONDS => Some(seconds / 60),
        _ => None,
    };
    Some(Battery {
        percent,
        state,
        minutes_left,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac(current: i64, charging: bool, charged: bool, on_ac: bool, minutes: i64) -> MacPower {
        MacPower {
            current,
            max: 100,
            charging,
            charged,
            on_ac,
            minutes,
        }
    }

    #[test]
    fn mac_on_battery_is_discharging_with_the_time_it_has_left() {
        assert_eq!(
            from_mac(mac(64, false, false, false, 215)),
            Some(Battery {
                percent: 64,
                state: BatteryState::Discharging,
                minutes_left: Some(215),
            })
        );
    }

    #[test]
    fn mac_plugged_in_and_charging_says_how_long_until_full() {
        assert_eq!(
            from_mac(mac(40, true, false, true, 75)),
            Some(Battery {
                percent: 40,
                state: BatteryState::Charging,
                minutes_left: Some(75),
            })
        );
    }

    #[test]
    fn mac_does_not_invent_a_time_while_it_is_still_calculating_it() {
        let battery = from_mac(mac(40, true, false, true, -1)).unwrap();
        assert_eq!(battery.state, BatteryState::Charging);
        assert_eq!(battery.minutes_left, None);
    }

    #[test]
    fn mac_plugged_in_without_charging_is_full_or_held_back() {
        assert_eq!(
            from_mac(mac(100, false, true, true, 0)).map(|b| (b.state, b.minutes_left)),
            Some((BatteryState::Full, None))
        );
        // Con un límite de carga del 80 % el equipo se queda enchufado sin cargar.
        assert_eq!(
            from_mac(mac(80, false, false, true, 0)).map(|b| (b.state, b.minutes_left)),
            Some((BatteryState::PluggedIn, None))
        );
    }

    #[test]
    fn mac_percent_comes_from_the_capacity_and_stays_between_0_and_100() {
        let half = MacPower {
            current: 2_500,
            max: 5_000,
            ..mac(0, false, false, false, -1)
        };
        assert_eq!(from_mac(half).map(|b| b.percent), Some(50));
        assert_eq!(
            from_mac(mac(130, false, false, false, -1)).map(|b| b.percent),
            Some(100)
        );
        assert_eq!(
            from_mac(mac(-5, false, false, false, -1)).map(|b| b.percent),
            Some(0)
        );
    }

    #[test]
    fn mac_without_a_capacity_is_not_a_battery() {
        let nothing = MacPower {
            max: 0,
            ..mac(0, false, false, false, -1)
        };
        assert_eq!(from_mac(nothing), None);
    }

    #[test]
    fn windows_without_a_battery_has_none() {
        assert_eq!(from_windows(1, 128, 255, u32::MAX), None);
        assert_eq!(from_windows(1, 128 | 1, 100, u32::MAX), None);
    }

    #[test]
    fn windows_that_does_not_know_the_level_has_none() {
        assert_eq!(from_windows(0, 1, 255, u32::MAX), None);
        assert_eq!(from_windows(0, 255, 255, u32::MAX), None);
    }

    #[test]
    fn windows_on_battery_is_discharging_with_the_minutes_it_has_left() {
        assert_eq!(
            from_windows(0, 1, 55, 9_000),
            Some(Battery {
                percent: 55,
                state: BatteryState::Discharging,
                minutes_left: Some(150),
            })
        );
        assert_eq!(
            from_windows(0, 2, 30, u32::MAX).map(|b| b.minutes_left),
            Some(None)
        );
    }

    #[test]
    fn windows_charging_gives_no_time() {
        assert_eq!(
            from_windows(1, 8, 70, u32::MAX),
            Some(Battery {
                percent: 70,
                state: BatteryState::Charging,
                minutes_left: None,
            })
        );
    }

    #[test]
    fn windows_plugged_in_is_full_at_100_and_held_back_below() {
        assert_eq!(
            from_windows(1, 1, 100, u32::MAX).map(|b| b.state),
            Some(BatteryState::Full)
        );
        assert_eq!(
            from_windows(1, 1, 80, u32::MAX).map(|b| b.state),
            Some(BatteryState::PluggedIn)
        );
    }

    #[test]
    fn the_state_is_sent_to_the_interface_in_camel_case() {
        let json = serde_json::to_value(Battery {
            percent: 5,
            state: BatteryState::PluggedIn,
            minutes_left: None,
        })
        .unwrap();
        assert_eq!(json["state"], "pluggedIn");
        assert_eq!(json["minutesLeft"], serde_json::Value::Null);
    }
}
