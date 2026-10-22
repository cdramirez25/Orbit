//! Dónde está el archivo del modelo de voz. Lo comparten el motor (que lo lee) y el servicio de
//! descarga (que lo baja, lo borra y lo mueve), así que cambiar la carpeta se nota en los dos a la vez.

use std::path::PathBuf;
use std::sync::{PoisonError, RwLock};

pub struct ModelLocation {
    /// Carpeta de datos de la app: donde va el modelo mientras el usuario no elija otra.
    default_dir: PathBuf,
    file_name: String,
    /// Carpeta que el usuario eligió, si eligió alguna.
    custom_dir: RwLock<Option<PathBuf>>,
}

impl ModelLocation {
    pub fn new(default_dir: PathBuf, file_name: &str, custom_dir: Option<PathBuf>) -> Self {
        Self {
            default_dir,
            file_name: file_name.to_owned(),
            custom_dir: RwLock::new(custom_dir),
        }
    }

    /// Una ubicación que nunca cambia de carpeta: el archivo exacto que se indica (tests).
    #[cfg(test)]
    pub fn fixed(file: PathBuf) -> Self {
        let name = file.file_name().map_or_else(
            || "model.bin".to_owned(),
            |n| n.to_string_lossy().into_owned(),
        );
        let dir = file.parent().map(PathBuf::from).unwrap_or_default();
        Self::new(dir, &name, None)
    }

    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    /// La carpeta que se usa ahora: la elegida o la de la app.
    pub fn dir(&self) -> PathBuf {
        self.custom_dir
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
            .unwrap_or_else(|| self.default_dir.clone())
    }

    /// El archivo del modelo, en la carpeta de ahora.
    pub fn path(&self) -> PathBuf {
        self.dir().join(&self.file_name)
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
        let location = ModelLocation::new(PathBuf::from("/app/models"), "m.bin", None);
        assert_eq!(location.path(), PathBuf::from("/app/models/m.bin"));
        assert!(!location.is_custom());

        location.set_custom_dir(Some(PathBuf::from("/Volumes/Externo")));
        assert_eq!(location.path(), PathBuf::from("/Volumes/Externo/m.bin"));
        assert_eq!(location.dir(), PathBuf::from("/Volumes/Externo"));
        assert!(location.is_custom());

        location.set_custom_dir(None);
        assert_eq!(location.path(), PathBuf::from("/app/models/m.bin"));
        assert!(!location.is_custom());
    }

    #[test]
    fn a_saved_custom_folder_is_used_from_the_start() {
        let location = ModelLocation::new(
            PathBuf::from("/app/models"),
            "m.bin",
            Some(PathBuf::from("/otra")),
        );
        assert_eq!(location.path(), PathBuf::from("/otra/m.bin"));
        assert_eq!(location.default_dir(), &PathBuf::from("/app/models"));
        assert_eq!(location.file_name(), "m.bin");
    }

    #[test]
    fn a_fixed_location_points_at_exactly_that_file() {
        let location = ModelLocation::fixed(PathBuf::from("/tmp/x/model.bin"));
        assert_eq!(location.path(), PathBuf::from("/tmp/x/model.bin"));
    }
}
