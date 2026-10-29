//! macOS: la batería se lee con IOKit (`IOPS*`), la API pública que usa el menú de la batería. Un
//! equipo sin batería (un Mac de escritorio) no tiene fuente de energía "InternalBattery".

use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;

use crate::system_stats::battery::{from_mac, MacPower};
use crate::system_stats::Battery;

/// `kIOPSInternalBatteryType`.
const INTERNAL_BATTERY: &str = "InternalBattery";
/// `kIOPSACPowerValue`.
const AC_POWER: &str = "AC Power";

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOPSCopyPowerSourcesInfo() -> CFTypeRef;
    fn IOPSCopyPowerSourcesList(blob: CFTypeRef) -> CFArrayRef;
    fn IOPSGetPowerSourceDescription(blob: CFTypeRef, source: CFTypeRef) -> CFDictionaryRef;
}

fn text(description: &CFDictionary<CFString, CFType>, key: &'static str) -> Option<String> {
    let value = description.find(CFString::from_static_string(key))?;
    Some(value.downcast::<CFString>()?.to_string())
}

fn number(description: &CFDictionary<CFString, CFType>, key: &'static str) -> Option<i64> {
    let value = description.find(CFString::from_static_string(key))?;
    value.downcast::<CFNumber>()?.to_i64()
}

fn flag(description: &CFDictionary<CFString, CFType>, key: &'static str) -> bool {
    description
        .find(CFString::from_static_string(key))
        .and_then(|value| value.downcast::<CFBoolean>())
        .is_some_and(bool::from)
}

pub fn read() -> Option<Battery> {
    // SAFETY: función de IOKit sin argumentos; devuelve un objeto que ahora es nuestro (regla "Copy").
    let info = unsafe { IOPSCopyPowerSourcesInfo() };
    if info.is_null() {
        return None;
    }
    // SAFETY: `info` no es nulo y se devolvió con la regla "Copy": hay que liberarlo, y esto lo hace.
    let info = unsafe { CFType::wrap_under_create_rule(info) };

    // SAFETY: `info` es válido y vive hasta el final de la función.
    let list = unsafe { IOPSCopyPowerSourcesList(info.as_CFTypeRef()) };
    if list.is_null() {
        return None;
    }
    // SAFETY: `list` no es nulo y se devolvió con la regla "Copy".
    let list: CFArray<CFType> = unsafe { CFArray::wrap_under_create_rule(list) };

    for source in list.iter() {
        // SAFETY: `info` y `source` son válidos; el diccionario sigue la regla "Get" (no es nuestro).
        let description =
            unsafe { IOPSGetPowerSourceDescription(info.as_CFTypeRef(), source.as_CFTypeRef()) };
        if description.is_null() {
            continue;
        }
        // SAFETY: no es nulo y es un diccionario de CoreFoundation; `wrap_under_get_rule` lo retiene.
        let description: CFDictionary<CFString, CFType> =
            unsafe { CFDictionary::wrap_under_get_rule(description) };

        if text(&description, "Type").as_deref() != Some(INTERNAL_BATTERY) {
            continue;
        }
        let minutes = if flag(&description, "Is Charging") {
            number(&description, "Time to Full Charge")
        } else {
            number(&description, "Time to Empty")
        };
        return from_mac(MacPower {
            current: number(&description, "Current Capacity")?,
            max: number(&description, "Max Capacity")?,
            charging: flag(&description, "Is Charging"),
            charged: flag(&description, "Is Charged"),
            on_ac: text(&description, "Power Source State").as_deref() == Some(AC_POWER),
            minutes: minutes.unwrap_or(-1),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La batería de este equipo, tal como la ve la interfaz. Manual: depende de si es un portátil.
    ///
    /// ```text
    /// cargo test live_reads_the_battery -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "depende de si este equipo tiene batería"]
    fn live_reads_the_battery() {
        let battery = read();
        println!("batería: {battery:?}");
        if let Some(battery) = battery {
            assert!(battery.percent <= 100);
        }
    }
}
