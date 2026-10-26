//! macOS: las salidas se leen y se cambian con CoreAudio (`AudioObject*`), la misma API que usan los
//! Ajustes del sistema. Se ignoran los dispositivos ocultos (los que crean otras apps para sí mismas)
//! y los que no tienen salida.

use std::ffi::c_void;
use std::mem::size_of;
use std::ptr;

use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};

use crate::sound_output::{OutputDevice, SoundOutputError};

/// `AudioObjectID`: el identificador de un objeto de CoreAudio.
type ObjectId = u32;
/// `OSStatus`: 0 es éxito.
type Status = i32;

#[repr(C)]
struct PropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

/// Cuatro letras como las escribe CoreAudio (`'dOut'`).
const fn four(code: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*code)
}

const SYSTEM_OBJECT: ObjectId = 1;
const SCOPE_GLOBAL: u32 = four(b"glob");
const SCOPE_OUTPUT: u32 = four(b"outp");
const ELEMENT_MAIN: u32 = 0;
const DEVICES: u32 = four(b"dev#");
const DEFAULT_OUTPUT: u32 = four(b"dOut");
const DEFAULT_SYSTEM_OUTPUT: u32 = four(b"sOut");
const NAME: u32 = four(b"lnam");
const UID: u32 = four(b"uid ");
const STREAMS: u32 = four(b"stm#");
const HIDDEN: u32 = four(b"hidn");

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyDataSize(
        object: ObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
    ) -> Status;
    fn AudioObjectGetPropertyData(
        object: ObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> Status;
    fn AudioObjectSetPropertyData(
        object: ObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: u32,
        data: *const c_void,
    ) -> Status;
}

const fn address(selector: u32, scope: u32) -> PropertyAddress {
    PropertyAddress {
        selector,
        scope,
        element: ELEMENT_MAIN,
    }
}

fn failure(what: &str, status: Status) -> String {
    format!("{what} (código {status})")
}

/// Lee una propiedad que es un solo valor de tipo `T` (un número o un puntero).
fn read<T: Copy + Default>(object: ObjectId, address: &PropertyAddress) -> Result<T, String> {
    let mut value = T::default();
    let mut size = size_of::<T>() as u32;
    // SAFETY: `value` tiene el tamaño que se anuncia en `size` y vive durante la llamada.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            address,
            0,
            ptr::null(),
            &mut size,
            (&mut value as *mut T).cast(),
        )
    };
    if status == 0 {
        Ok(value)
    } else {
        Err(failure("no se pudo leer una propiedad", status))
    }
}

/// Lee una propiedad que es una lista de identificadores.
fn read_ids(object: ObjectId, address: &PropertyAddress) -> Result<Vec<ObjectId>, String> {
    let mut size = 0_u32;
    // SAFETY: `size` es una variable local válida para escribir.
    let status =
        unsafe { AudioObjectGetPropertyDataSize(object, address, 0, ptr::null(), &mut size) };
    if status != 0 {
        return Err(failure("no se pudo leer el tamaño de una lista", status));
    }
    let mut ids = vec![0 as ObjectId; size as usize / size_of::<ObjectId>()];
    if ids.is_empty() {
        return Ok(ids);
    }
    // SAFETY: `ids` tiene sitio para `size` bytes, que es lo que se anuncia.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            address,
            0,
            ptr::null(),
            &mut size,
            ids.as_mut_ptr().cast(),
        )
    };
    if status != 0 {
        return Err(failure("no se pudo leer una lista", status));
    }
    ids.truncate(size as usize / size_of::<ObjectId>());
    Ok(ids)
}

/// Lee una propiedad de texto (`CFString`).
fn read_text(object: ObjectId, selector: u32) -> Option<String> {
    // Un puntero cabe en un `usize`: así se lee con la misma función que los números.
    let raw = read::<usize>(object, &address(selector, SCOPE_GLOBAL)).ok()? as CFStringRef;
    if raw.is_null() {
        return None;
    }
    // SAFETY: CoreAudio entrega la cadena ya retenida (regla "create"): `CFString` la libera.
    Some(unsafe { CFString::wrap_under_create_rule(raw) }.to_string())
}

fn has_output(device: ObjectId) -> bool {
    let mut size = 0_u32;
    let streams = address(STREAMS, SCOPE_OUTPUT);
    // SAFETY: `size` es una variable local válida para escribir.
    let status =
        unsafe { AudioObjectGetPropertyDataSize(device, &streams, 0, ptr::null(), &mut size) };
    status == 0 && size > 0
}

fn is_hidden(device: ObjectId) -> bool {
    read::<u32>(device, &address(HIDDEN, SCOPE_GLOBAL)).is_ok_and(|hidden| hidden != 0)
}

fn default_output() -> Result<ObjectId, String> {
    read(SYSTEM_OBJECT, &address(DEFAULT_OUTPUT, SCOPE_GLOBAL))
}

pub fn list() -> Result<Vec<OutputDevice>, SoundOutputError> {
    let list_error = SoundOutputError::List;
    let default = default_output().map_err(list_error)?;
    let ids = read_ids(SYSTEM_OBJECT, &address(DEVICES, SCOPE_GLOBAL)).map_err(list_error)?;

    Ok(ids
        .into_iter()
        .filter(|device| has_output(*device) && !is_hidden(*device))
        .filter_map(|device| {
            Some(OutputDevice {
                id: read_text(device, UID)?,
                name: read_text(device, NAME)?,
                is_default: device == default,
            })
        })
        .collect())
}

pub fn set_default(id: &str) -> Result<(), SoundOutputError> {
    let ids =
        read_ids(SYSTEM_OBJECT, &address(DEVICES, SCOPE_GLOBAL)).map_err(SoundOutputError::Set)?;
    let device = ids
        .into_iter()
        .filter(|device| has_output(*device))
        .find(|device| read_text(*device, UID).as_deref() == Some(id))
        .ok_or(SoundOutputError::NotFound)?;

    // La salida normal y la de los avisos del sistema, como hacen los Ajustes del sistema.
    for selector in [DEFAULT_OUTPUT, DEFAULT_SYSTEM_OUTPUT] {
        let target = address(selector, SCOPE_GLOBAL);
        // SAFETY: se pasa un `u32` y su tamaño; el objeto es el del sistema.
        let status = unsafe {
            AudioObjectSetPropertyData(
                SYSTEM_OBJECT,
                &target,
                0,
                ptr::null(),
                size_of::<ObjectId>() as u32,
                (&device as *const ObjectId).cast(),
            )
        };
        if status != 0 {
            return Err(SoundOutputError::Set(failure(
                "macOS no aceptó el cambio",
                status,
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_letter_codes_match_the_ones_coreaudio_documents() {
        assert_eq!(DEFAULT_OUTPUT, 0x644F_7574);
        assert_eq!(DEVICES, 0x6465_7623);
        assert_eq!(SCOPE_GLOBAL, 0x676C_6F62);
    }

    /// Lee las salidas reales del equipo y comprueba que hay una sola predeterminada. Manual:
    /// depende de lo que tengas conectado.
    ///
    /// ```text
    /// cargo test live_lists_the_outputs -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "depende de los dispositivos de sonido conectados"]
    fn live_lists_the_outputs() {
        let devices = list().expect("CoreAudio debe responder");
        for device in &devices {
            println!(
                "{} | {} | default={}",
                device.id, device.name, device.is_default
            );
        }
        assert!(!devices.is_empty());
        assert_eq!(devices.iter().filter(|d| d.is_default).count(), 1);
    }

    /// Vuelve a elegir la salida que ya está en uso: pasa por todo el camino de `set_default` sin
    /// cambiar nada de verdad.
    ///
    /// ```text
    /// cargo test live_choosing_the_current_output -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "toca la salida de sonido real del sistema"]
    fn live_choosing_the_current_output_keeps_it() {
        let before = list().expect("CoreAudio debe responder");
        let current = before
            .iter()
            .find(|device| device.is_default)
            .expect("hay una salida predeterminada");

        set_default(&current.id).expect("macOS debe aceptar la misma salida");

        let after = list().expect("CoreAudio debe responder");
        assert_eq!(
            after.iter().find(|device| device.is_default).map(|d| &d.id),
            Some(&current.id)
        );
    }

    /// Cambia de verdad a otra salida y vuelve a la de antes (siempre, aunque falle algo). Se oye un
    /// instante por la otra salida si hay sonido en marcha.
    ///
    /// ```text
    /// cargo test live_switching_to_another_output -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "cambia por un instante la salida de sonido real del sistema"]
    fn live_switching_to_another_output_and_back() {
        let before = list().expect("CoreAudio debe responder");
        let original = before
            .iter()
            .find(|device| device.is_default)
            .expect("hay una salida predeterminada")
            .id
            .clone();
        let other = before
            .iter()
            .find(|device| !device.is_default)
            .expect("hace falta una segunda salida conectada")
            .id
            .clone();

        let switched = set_default(&other).and_then(|()| list());
        // Se restaura antes de comprobar nada.
        let restored = set_default(&original).and_then(|()| list());

        let default_of = |devices: &[OutputDevice]| {
            devices
                .iter()
                .find(|device| device.is_default)
                .map(|device| device.id.clone())
        };
        assert_eq!(default_of(&switched.expect("el cambio")), Some(other));
        assert_eq!(default_of(&restored.expect("la vuelta")), Some(original));
    }
}
