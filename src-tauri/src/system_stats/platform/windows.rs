//! Windows: la batería se lee con `GetSystemPowerStatus`. Un equipo de escritorio responde que no
//! tiene batería.

use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

use crate::system_stats::battery::from_windows;
use crate::system_stats::Battery;

pub fn read() -> Option<Battery> {
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: `status` es nuestro y la función solo escribe dentro de él.
    unsafe { GetSystemPowerStatus(&mut status) }.ok()?;
    from_windows(
        status.ACLineStatus,
        status.BatteryFlag,
        status.BatteryLifePercent,
        status.BatteryLifeTime,
    )
}
