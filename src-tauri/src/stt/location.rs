//! Dónde están los archivos de los modelos de voz y cuál se usa. Lo comparten el motor (que lee el
//! activo) y el servicio de descarga (que baja, borra y mueve), así que cambiar la carpeta o el
//! modelo se nota en los dos a la vez.

use std::path::PathBuf;
use std::sync::{PoisonError, RwLock};

use super::catalog::SttModel;

pub struct ModelLocation {
    /// Carpeta de datos de la app: donde van los modelos mientras el usuario no elija otra.
    default_dir: PathBuf,
    /// Carpeta que el usuario eligió, si eligió alguna.
    custom_dir: RwLock<Option<PathBuf>>,
    /// El modelo que usa el motor.
    active: RwLock<SttModel>,
}

impl ModelLocation {
    pub fn new(default_dir: PathBuf, custom_dir: Option<PathBuf>, active: SttModel) -> Self {
        Self {
            default_dir,
            custom_dir: RwLock::new(custom_dir),
            active: RwLock::new(active),
        }
    }

    /// Una ubicación en esa carpeta, con el modelo por defecto (tests).
    #[cfg(test)]
    pub fn in_dir(dir: PathBuf) -> Self {
        Self::new(dir, None, SttModel::default())
    }

    /// La carpeta que se usa ahora: la elegida o la de la app.
    pub fn dir(&self) -> PathBuf {
        self.custom_dir
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
            .unwrap_or_else(|| self.default_dir.clone())
    }

    /// El archivo de ese modelo, en la carpeta de ahora.
    pub fn path_of(&self, model: SttModel) -> PathBuf {
        self.dir().join(model.file_name())
    }

    /// El archivo del modelo activo.
    pub fn path(&self) -> PathBuf {
        self.path_of(self.active())
    }

    pub fn active(&self) -> SttModel {
        *self.active.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set_active(&self, model: SttModel) {
        *self.active.write().unwrap_or_else(PoisonError::into_inner) = model;
    }

    /// ¿El usuario eligió una carpeta propia?
    pub fn is_custom(&self) -> bool {
        self.custom_dir
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
    }

    pub fn default_dir(&self) -> &PathBuf {
        &self.default_dir
    }

    /// Cambia la carpeta (`None` = volver a la de la app). No mueve ningún archivo.
    pub fn set_custom_dir(&self, dir: Option<PathBuf>) {
        *self
            .custom_dir
            .write()
            .unwrap_or_else(PoisonError::into_inner) = dir;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_uses_the_app_folder_until_the_user_picks_another() {
        let location = ModelLocation::new(PathBuf::from("/app/models"), None, SttModel::Small);
        assert_eq!(location.path(), PathBuf::from("/app/models/ggml-small.bin"));
        assert!(!location.is_custom());

        location.set_custom_dir(Some(PathBuf::from("/Volumes/Externo")));
        assert_eq!(
            location.path(),
            PathBuf::from("/Volumes/Externo/ggml-small.bin")
        );
        assert_eq!(location.dir(), PathBuf::from("/Volumes/Externo"));
        assert!(location.is_custom());

        location.set_custom_dir(None);
        assert_eq!(location.path(), PathBuf::from("/app/models/ggml-small.bin"));
        assert!(!location.is_custom());
    }

    #[test]
    fn a_saved_custom_folder_is_used_from_the_start() {
        let location = ModelLocation::new(
            PathBuf::from("/app/models"),
            Some(PathBuf::from("/otra")),
            SttModel::Base,
        );
        assert_eq!(location.path(), PathBuf::from("/otra/ggml-base.bin"));
        assert_eq!(location.default_dir(), &PathBuf::from("/app/models"));
    }

    #[test]
    fn the_path_follows_the_active_model() {
        let location = ModelLocation::in_dir(PathBuf::from("/m"));
        assert_eq!(location.active(), SttModel::Small);

        location.set_active(SttModel::Medium);
        assert_eq!(location.active(), SttModel::Medium);
        assert_eq!(location.path(), PathBuf::from("/m/ggml-medium.bin"));
        // Los demás siguen teniendo su propio archivo.
        assert_eq!(
            location.path_of(SttModel::Base),
            PathBuf::from("/m/ggml-base.bin")
        );
    }
}
