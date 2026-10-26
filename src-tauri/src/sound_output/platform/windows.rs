//! Windows 10 y 11: las salidas se leen con WASAPI (la crate `wasapi`, la misma que captura el audio)
//! y la predeterminada se cambia con `IPolicyConfig`, la interfaz no documentada que usan el
//! mezclador de volumen de Windows y los cambiadores de salida de sonido. Verificar a mano en un
//! Windows real.

// Los métodos de `IPolicyConfig` llevan los nombres de la interfaz COM de Windows, no los de Rust.
#![allow(non_snake_case)]

use std::ffi::c_void;

use wasapi::{DeviceEnumerator, Direction};
use windows::core::{interface, IUnknown, IUnknown_Vtbl, GUID, HRESULT, PCWSTR};
use windows::Win32::Media::Audio::{eCommunications, eConsole, eMultimedia, ERole};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

use crate::sound_output::{OutputDevice, SoundOutputError};

/// `CLSID_PolicyConfigClient`.
const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

/// `IPolicyConfig` (Windows Vista y posteriores). Solo importa `SetDefaultEndpoint`; los demás
/// métodos están para que sus posiciones en la tabla de funciones sean las correctas.
#[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
unsafe trait IPolicyConfig: IUnknown {
    fn GetMixFormat(&self, device: PCWSTR, format: *mut *mut c_void) -> HRESULT;
    fn GetDeviceFormat(&self, device: PCWSTR, default: i32, format: *mut *mut c_void) -> HRESULT;
    fn ResetDeviceFormat(&self, device: PCWSTR) -> HRESULT;
    fn SetDeviceFormat(&self, device: PCWSTR, endpoint: *mut c_void, mix: *mut c_void) -> HRESULT;
    fn GetProcessingPeriod(
        &self,
        device: PCWSTR,
        default: i32,
        default_period: *mut i64,
        min_period: *mut i64,
    ) -> HRESULT;
    fn SetProcessingPeriod(&self, device: PCWSTR, period: *mut i64) -> HRESULT;
    fn GetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn SetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn GetPropertyValue(
        &self,
        device: PCWSTR,
        fx_store: i32,
        key: *const c_void,
        value: *mut c_void,
    ) -> HRESULT;
    fn SetPropertyValue(
        &self,
        device: PCWSTR,
        fx_store: i32,
        key: *const c_void,
        value: *mut c_void,
    ) -> HRESULT;
    fn SetDefaultEndpoint(&self, device: PCWSTR, role: ERole) -> HRESULT;
    fn SetEndpointVisibility(&self, device: PCWSTR, visible: i32) -> HRESULT;
}

pub fn list() -> Result<Vec<OutputDevice>, SoundOutputError> {
    let fail = |error: wasapi::WasapiError| SoundOutputError::List(error.to_string());
    wasapi::initialize_mta()
        .ok()
        .map_err(|e| SoundOutputError::List(e.to_string()))?;
    let enumerator = DeviceEnumerator::new().map_err(fail)?;
    let default_id = enumerator
        .get_default_device(&Direction::Render)
        .and_then(|device| device.get_id())
        .ok();
    let collection = enumerator
        .get_device_collection(&Direction::Render)
        .map_err(fail)?;
    let count = collection.get_nbr_devices().map_err(fail)?;

    let mut devices = Vec::new();
    for index in 0..count {
        let Ok(device) = collection.get_device_at_index(index) else {
            continue;
        };
        let (Ok(id), Ok(name)) = (device.get_id(), device.get_friendlyname()) else {
            continue;
        };
        devices.push(OutputDevice {
            is_default: default_id.as_deref() == Some(id.as_str()),
            id,
            name,
        });
    }
    Ok(devices)
}

pub fn set_default(id: &str) -> Result<(), SoundOutputError> {
    // Solo se cambia a una salida que sigue conectada.
    if !list()?.iter().any(|device| device.id == id) {
        return Err(SoundOutputError::NotFound);
    }
    let fail = |error: windows::core::Error| SoundOutputError::Set(error.to_string());
    let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();

    // SAFETY: se crea el objeto de política de audio de Windows y se le pasa un texto terminado en
    // cero que vive durante las llamadas; `wasapi::initialize_mta` (en `list`) ya inició COM.
    unsafe {
        let policy: IPolicyConfig =
            CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL).map_err(fail)?;
        // Los tres roles, para que cambie igual para música, juegos y llamadas.
        for role in [eConsole, eMultimedia, eCommunications] {
            policy
                .SetDefaultEndpoint(PCWSTR(wide.as_ptr()), role)
                .ok()
                .map_err(fail)?;
        }
    }
    Ok(())
}
