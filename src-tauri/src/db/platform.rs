//! Código específico de plataforma de la base de datos: que el archivo solo lo lea su dueño.

use std::fs::OpenOptions;
use std::io;
use std::path::Path;

/// Crea el archivo vacío si no existe, ya privado: en macOS y Linux solo lo puede leer su dueño
/// (0600); en Windows queda dentro del perfil del usuario, que es privado. Si ya existe, no lo toca.
pub fn create_private_if_missing(path: &Path) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map(|_| ())
}
