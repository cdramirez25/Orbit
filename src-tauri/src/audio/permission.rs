//! Permiso para capturar el audio del sistema (puerto + lógica de estado).

use serde::Serialize;

use super::AudioError;

/// Estado del permiso, tal como lo ve la interfaz (`src/types/audio.ts` es su espejo).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionStatus {
    Granted,
    /// Ya se le pidió al usuario y sigue sin concederlo: hay que mandarlo a Ajustes del Sistema.
    Denied,
    /// Todavía no se ha pedido.
    NotDetermined,
    /// Este sistema operativo no exige ningún permiso (Windows).
    NotRequired,
}

/// Puerto: cómo se pide y se consulta el permiso en cada sistema operativo.
pub trait AudioPermission: Send + Sync {
    /// ¿Exige este sistema un permiso para capturar el audio de salida?
    fn required(&self) -> bool;
    /// ¿Está concedido ahora mismo? No muestra ningún aviso.
    fn is_granted(&self) -> bool;
    /// Se lo pide al sistema (su aviso sale solo la primera vez). Devuelve si ya está concedido.
    fn request(&self) -> bool;
    /// Abre la pantalla del sistema donde el usuario lo concede.
    fn open_system_settings(&self) -> Result<(), AudioError>;
}

/// Estado a mostrar. macOS solo dice "concedido sí/no"; para distinguir "no pedido" de
/// "denegado" hace falta saber si ya se le pidió al usuario (`already_prompted`).
pub fn status_of(permission: &dyn AudioPermission, already_prompted: bool) -> PermissionStatus {
    if !permission.required() {
        PermissionStatus::NotRequired
    } else if permission.is_granted() {
        PermissionStatus::Granted
    } else if already_prompted {
        PermissionStatus::Denied
    } else {
        PermissionStatus::NotDetermined
    }
}

#[cfg(test)]
pub mod testing {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::{AudioError, AudioPermission};

    /// Permiso simulado: se configura a mano y cuenta las veces que se pidió.
    pub struct FakeAudioPermission {
        pub required: bool,
        pub granted: AtomicBool,
        pub requests: AtomicUsize,
    }

    impl FakeAudioPermission {
        pub fn new(required: bool, granted: bool) -> Self {
            Self {
                required,
                granted: AtomicBool::new(granted),
                requests: AtomicUsize::new(0),
            }
        }
    }

    impl AudioPermission for FakeAudioPermission {
        fn required(&self) -> bool {
            self.required
        }
        fn is_granted(&self) -> bool {
            self.granted.load(Ordering::SeqCst)
        }
        fn request(&self) -> bool {
            self.requests.fetch_add(1, Ordering::SeqCst);
            self.is_granted()
        }
        fn open_system_settings(&self) -> Result<(), AudioError> {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;

    use serde_json::json;

    use super::testing::FakeAudioPermission;
    use super::*;

    #[test]
    fn systems_without_a_permission_report_not_required() {
        let windows_like = FakeAudioPermission::new(false, true);
        assert_eq!(
            status_of(&windows_like, false),
            PermissionStatus::NotRequired
        );
        assert_eq!(
            status_of(&windows_like, true),
            PermissionStatus::NotRequired
        );
    }

    #[test]
    fn granted_wins_over_everything_else() {
        let permission = FakeAudioPermission::new(true, true);
        assert_eq!(status_of(&permission, false), PermissionStatus::Granted);
        assert_eq!(status_of(&permission, true), PermissionStatus::Granted);
    }

    #[test]
    fn not_granted_and_never_asked_is_not_determined() {
        let permission = FakeAudioPermission::new(true, false);
        assert_eq!(
            status_of(&permission, false),
            PermissionStatus::NotDetermined
        );
    }

    #[test]
    fn not_granted_after_asking_is_denied() {
        let permission = FakeAudioPermission::new(true, false);
        assert_eq!(status_of(&permission, true), PermissionStatus::Denied);
    }

    #[test]
    fn granting_later_flips_the_status() {
        let permission = FakeAudioPermission::new(true, false);
        assert_eq!(status_of(&permission, true), PermissionStatus::Denied);
        permission.granted.store(true, Ordering::SeqCst);
        assert_eq!(status_of(&permission, true), PermissionStatus::Granted);
    }

    #[test]
    fn requesting_is_recorded_by_the_port() {
        let permission = FakeAudioPermission::new(true, false);
        assert!(!permission.request());
        assert_eq!(permission.requests.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn wire_format_matches_the_frontend() {
        assert_eq!(json!(PermissionStatus::Granted), "granted");
        assert_eq!(json!(PermissionStatus::Denied), "denied");
        assert_eq!(json!(PermissionStatus::NotDetermined), "notDetermined");
        assert_eq!(json!(PermissionStatus::NotRequired), "notRequired");
    }
}
