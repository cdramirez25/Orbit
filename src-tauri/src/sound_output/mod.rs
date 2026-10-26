//! La salida de sonido: ver qué dispositivos hay (altavoces del equipo, audífonos, un monitor con
//! bocinas…) y elegir por cuál suena el equipo. Sirve, por ejemplo, para que el sonido del fondo de
//! pantalla salga por los audífonos y no por el altavoz del equipo.
//!
//! Núcleo (§4.0): aquí viven los tipos y la regla de elegir (`SoundOutputService`); lo que de verdad
//! habla con el sistema operativo es el puerto `OutputSwitch` (adaptador en `platform/`), que elige
//! el composition root (`lib.rs`). Elegir una salida cambia la salida predeterminada del sistema (la
//! misma que se cambia en Ajustes del sistema): vale para todas las apps y se queda así al cerrar
//! Orbit.

pub mod platform;

use serde::Serialize;

/// Un dispositivo de salida de sonido. Espejo de `SoundOutputDevice` en `src/types/soundOutput.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    /// Identificador estable que da el sistema (no cambia al reconectarlo).
    pub id: String,
    /// El nombre para mostrarlo ("Altavoces del MacBook Pro", "AirPods de Cristian"…).
    pub name: String,
    /// ¿Es la salida que usa el sistema ahora?
    pub is_default: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum SoundOutputError {
    #[error("no se pudieron leer las salidas de sonido: {0}")]
    List(String),
    #[error("no se pudo cambiar la salida de sonido: {0}")]
    Set(String),
    #[error("esa salida de sonido ya no está conectada")]
    NotFound,
}

impl SoundOutputError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::List(_) => "soundOutput.list",
            Self::Set(_) => "soundOutput.set",
            Self::NotFound => "soundOutput.notFound",
        }
    }
}

/// Puerto: lo que el sistema operativo sabe de sus salidas de sonido.
pub trait OutputSwitch: Send + Sync {
    /// Las salidas conectadas ahora (sin las ocultas ni las que no suenan).
    fn list(&self) -> Result<Vec<OutputDevice>, SoundOutputError>;
    /// Hace que el sistema use esa salida.
    fn set_default(&self, id: &str) -> Result<(), SoundOutputError>;
}

pub struct SoundOutputService {
    switch: Box<dyn OutputSwitch>,
}

impl SoundOutputService {
    pub fn new(switch: Box<dyn OutputSwitch>) -> Self {
        Self { switch }
    }

    /// Las salidas conectadas ahora, por nombre.
    pub fn list(&self) -> Result<Vec<OutputDevice>, SoundOutputError> {
        let mut devices = self.switch.list()?;
        devices.sort_by_key(|device| device.name.to_lowercase());
        Ok(devices)
    }

    /// Cambia la salida de sonido del sistema y devuelve cómo quedó la lista. Falla si esa salida ya
    /// no está conectada; si ya era la salida, no toca nada.
    pub fn choose(&self, id: &str) -> Result<Vec<OutputDevice>, SoundOutputError> {
        let devices = self.list()?;
        let Some(wanted) = devices.iter().find(|device| device.id == id) else {
            return Err(SoundOutputError::NotFound);
        };
        if wanted.is_default {
            return Ok(devices);
        }
        self.switch.set_default(id)?;
        self.list()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    struct FakeSwitch {
        devices: Mutex<Vec<OutputDevice>>,
        sets: Mutex<Vec<String>>,
        fail_set: bool,
    }

    fn device(id: &str, name: &str, is_default: bool) -> OutputDevice {
        OutputDevice {
            id: id.into(),
            name: name.into(),
            is_default,
        }
    }

    impl OutputSwitch for Arc<FakeSwitch> {
        fn list(&self) -> Result<Vec<OutputDevice>, SoundOutputError> {
            Ok(self.devices.lock().unwrap().clone())
        }
        fn set_default(&self, id: &str) -> Result<(), SoundOutputError> {
            if self.fail_set {
                return Err(SoundOutputError::Set("no".into()));
            }
            self.sets.lock().unwrap().push(id.into());
            for device in self.devices.lock().unwrap().iter_mut() {
                device.is_default = device.id == id;
            }
            Ok(())
        }
    }

    fn service(fail_set: bool) -> (SoundOutputService, Arc<FakeSwitch>) {
        let switch = Arc::new(FakeSwitch {
            devices: Mutex::new(vec![
                device("speakers", "Altavoces", true),
                device("buds", "audífonos", false),
                device("monitor", "Monitor", false),
            ]),
            sets: Mutex::new(Vec::new()),
            fail_set,
        });
        (
            SoundOutputService::new(Box::new(Arc::clone(&switch))),
            switch,
        )
    }

    #[test]
    fn the_outputs_are_listed_by_name_ignoring_case() {
        let (service, _) = service(false);
        let names: Vec<_> = service
            .list()
            .unwrap()
            .into_iter()
            .map(|device| device.name)
            .collect();
        assert_eq!(names, vec!["Altavoces", "audífonos", "Monitor"]);
    }

    #[test]
    fn choosing_an_output_makes_it_the_default_and_returns_the_new_list() {
        let (service, switch) = service(false);

        let devices = service.choose("buds").unwrap();

        assert_eq!(*switch.sets.lock().unwrap(), vec!["buds".to_owned()]);
        assert_eq!(
            devices
                .iter()
                .filter(|device| device.is_default)
                .map(|device| device.id.as_str())
                .collect::<Vec<_>>(),
            vec!["buds"]
        );
    }

    #[test]
    fn choosing_the_output_already_in_use_changes_nothing() {
        let (service, switch) = service(false);
        service.choose("speakers").unwrap();
        assert!(switch.sets.lock().unwrap().is_empty());
    }

    #[test]
    fn an_output_that_is_gone_is_an_error_and_changes_nothing() {
        let (service, switch) = service(false);

        let error = service.choose("unplugged").unwrap_err();

        assert_eq!(error.code(), "soundOutput.notFound");
        assert!(switch.sets.lock().unwrap().is_empty());
    }

    #[test]
    fn a_failure_from_the_system_is_reported() {
        let (service, _) = service(true);
        assert_eq!(
            service.choose("buds").unwrap_err().code(),
            "soundOutput.set"
        );
    }

    #[test]
    fn the_wire_format_matches_the_frontend() {
        assert_eq!(
            serde_json::to_value(device("a", "Altavoces", true)).unwrap(),
            serde_json::json!({ "id": "a", "name": "Altavoces", "isDefault": true })
        );
        assert_eq!(
            SoundOutputError::List(String::new()).code(),
            "soundOutput.list"
        );
    }
}
