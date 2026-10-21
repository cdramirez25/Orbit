//! Configuración de la app, persistida como JSON en el directorio de configuración. Las API keys
//! NO viven aquí: van al llavero del SO (`keychain.rs`, Fase 5).

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Dónde se coloca la isla en la pantalla.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandAnchor {
    Left,
    /// Centrada en el monitor (sobre el notch si lo hay); se recalcula sola al cambiar la pantalla.
    #[default]
    Center,
    Right,
    /// Donde el usuario la arrastre y la suelte.
    Free,
}

/// Punto en coordenadas globales lógicas (puntos), con el origen arriba a la izquierda.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Oculta la isla de la pantalla compartida (por defecto ON, §3.3).
    pub hide_from_screen_share: bool,
    pub island_anchor: IslandAnchor,
    /// Esquina superior izquierda de la ventana en modo libre.
    pub free_origin: Option<Point>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hide_from_screen_share: true,
            island_anchor: IslandAnchor::Center,
            free_origin: None,
        }
    }
}

impl Settings {
    /// Lee los ajustes; si el archivo no existe o está dañado, usa los valores por defecto.
    pub fn load(path: &Path) -> Self {
        let Ok(text) = fs::read_to_string(path) else {
            return Self::default();
        };
        serde_json::from_str(&text).unwrap_or_else(|error| {
            tracing::warn!(%error, "ajustes ilegibles; se usan los valores por defecto");
            Self::default()
        })
    }

    /// Escritura atómica (archivo temporal + renombrar) para no dejar un JSON a medias.
    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let temp = path.with_extension("json.tmp");
        fs::write(&temp, serde_json::to_string_pretty(self)?)?;
        fs::rename(temp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("orbit-test-{}-{name}.json", std::process::id()))
    }

    #[test]
    fn defaults_are_center_and_hidden_from_screen_share() {
        let settings = Settings::default();
        assert_eq!(settings.island_anchor, IslandAnchor::Center);
        assert!(settings.hide_from_screen_share);
        assert_eq!(settings.free_origin, None);
    }

    #[test]
    fn roundtrips_through_disk() {
        let path = temp_path("roundtrip");
        let settings = Settings {
            hide_from_screen_share: false,
            island_anchor: IslandAnchor::Free,
            free_origin: Some(Point { x: 120.5, y: 40.0 }),
        };
        settings.save(&path).unwrap();
        assert_eq!(Settings::load(&path), settings);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn missing_file_gives_defaults() {
        assert_eq!(
            Settings::load(&temp_path("does-not-exist")),
            Settings::default()
        );
    }

    #[test]
    fn corrupt_file_gives_defaults() {
        let path = temp_path("corrupt");
        fs::write(&path, "{ esto no es json").unwrap();
        assert_eq!(Settings::load(&path), Settings::default());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn partial_file_keeps_defaults_for_missing_fields() {
        let path = temp_path("partial");
        fs::write(&path, r#"{ "islandAnchor": "left" }"#).unwrap();
        let settings = Settings::load(&path);
        assert_eq!(settings.island_anchor, IslandAnchor::Left);
        assert!(settings.hide_from_screen_share);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn wire_format_matches_the_frontend() {
        let json = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(json["islandAnchor"], "center");
        assert_eq!(json["hideFromScreenShare"], true);
        assert!(json["freeOrigin"].is_null());
    }
}
