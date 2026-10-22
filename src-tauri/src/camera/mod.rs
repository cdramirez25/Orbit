//! Cámara: la vista previa y el disparo los hace la interfaz (con la cámara del webview, solo
//! mientras el módulo está abierto). Aquí vive lo que tiene que pasar en Rust: validar la foto que
//! llega, guardarla en la carpeta Imágenes y mandar al usuario a la pantalla de privacidad del
//! sistema si negó el permiso. La foto nunca se escribe en los logs ni sale de la computadora.

pub mod platform;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// Una foto de la cámara en PNG no pasa de unos cientos de KB; esto deja mucho margen y corta lo
/// que no sea una foto.
const MAX_PHOTO_BYTES: usize = 25 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Debug, thiserror::Error)]
pub enum CameraError {
    #[error("la foto no es válida")]
    InvalidPhoto,
    #[error("no se pudo guardar la foto: {0}")]
    Save(String),
    #[error("no se pudo abrir la pantalla de privacidad: {0}")]
    OpenSettings(String),
}

impl CameraError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidPhoto => "camera.invalidPhoto",
            Self::Save(_) => "camera.save",
            Self::OpenSettings(_) => "camera.openSettings",
        }
    }
}

/// La foto que manda la interfaz (PNG en base64, sin el prefijo `data:`) → los bytes del PNG.
pub fn decode_photo(base64: &str) -> Result<Vec<u8>, CameraError> {
    let bytes = STANDARD
        .decode(base64.trim())
        .map_err(|_| CameraError::InvalidPhoto)?;
    if bytes.len() > MAX_PHOTO_BYTES || !bytes.starts_with(&PNG_SIGNATURE) {
        return Err(CameraError::InvalidPhoto);
    }
    Ok(bytes)
}

/// Guarda el PNG en `dir` como `Orbit-<sello>.png` (creando la carpeta si falta). Si ese nombre ya
/// existe, añade `-2`, `-3`… sin pisar nada. Devuelve la ruta del archivo.
pub fn save_photo(dir: &Path, png: &[u8], stamp: &str) -> Result<PathBuf, CameraError> {
    fs::create_dir_all(dir).map_err(|error| CameraError::Save(error.to_string()))?;
    for attempt in 1..=100 {
        let name = if attempt == 1 {
            format!("Orbit-{stamp}.png")
        } else {
            format!("Orbit-{stamp}-{attempt}.png")
        };
        let path = dir.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(png)
                    .map_err(|error| CameraError::Save(error.to_string()))?;
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(CameraError::Save(error.to_string())),
        }
    }
    Err(CameraError::Save(
        "demasiadas fotos en el mismo segundo".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El PNG más pequeño válido (1×1, un píxel).
    const TINY_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8,
        0xFF, 0xFF, 0x3F, 0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59, 0xE7, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("orbit-camera-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_png_in_base64_is_decoded() {
        let encoded = STANDARD.encode(TINY_PNG);
        assert_eq!(decode_photo(&encoded).unwrap(), TINY_PNG);
        assert_eq!(decode_photo(&format!("  {encoded}\n")).unwrap(), TINY_PNG);
    }

    #[test]
    fn anything_that_is_not_a_png_is_refused() {
        for bad in ["", "esto no es base64 !!!", &STANDARD.encode(b"hola mundo")] {
            assert_eq!(
                decode_photo(bad).unwrap_err().code(),
                "camera.invalidPhoto",
                "{bad:?}"
            );
        }
        // Un JPEG (empieza distinto) tampoco vale.
        let jpeg = STANDARD.encode([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]);
        assert!(decode_photo(&jpeg).is_err());
    }

    #[test]
    fn a_huge_file_is_refused() {
        let mut big = PNG_SIGNATURE.to_vec();
        big.resize(MAX_PHOTO_BYTES + 1, 0);
        assert!(decode_photo(&STANDARD.encode(big)).is_err());
    }

    #[test]
    fn saving_creates_the_folder_and_the_file() {
        let dir = temp_dir("save").join("Orbit");
        let path = save_photo(&dir, TINY_PNG, "2026-10-22-18-30-05").unwrap();

        assert_eq!(path, dir.join("Orbit-2026-10-22-18-30-05.png"));
        assert_eq!(fs::read(&path).unwrap(), TINY_PNG);
        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn saving_twice_in_the_same_second_never_overwrites() {
        let dir = temp_dir("twice");
        let first = save_photo(&dir, TINY_PNG, "2026-10-22-18-30-05").unwrap();
        let second = save_photo(&dir, b"otra", "2026-10-22-18-30-05").unwrap();

        assert_ne!(first, second);
        assert_eq!(second, dir.join("Orbit-2026-10-22-18-30-05-2.png"));
        assert_eq!(
            fs::read(&first).unwrap(),
            TINY_PNG,
            "la primera sigue igual"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_folder_that_cannot_be_created_is_a_save_error() {
        let blocker = temp_dir("blocked");
        fs::create_dir_all(&blocker).unwrap();
        let file = blocker.join("archivo");
        fs::write(&file, b"x").unwrap();

        let error = save_photo(&file.join("dentro"), TINY_PNG, "x").unwrap_err();
        assert_eq!(error.code(), "camera.save");
        let _ = fs::remove_dir_all(blocker);
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(CameraError::InvalidPhoto.code(), "camera.invalidPhoto");
        assert_eq!(CameraError::Save(String::new()).code(), "camera.save");
        assert_eq!(
            CameraError::OpenSettings(String::new()).code(),
            "camera.openSettings"
        );
    }
}
