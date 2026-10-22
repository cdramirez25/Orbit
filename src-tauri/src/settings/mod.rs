//! Configuración de la app, persistida como JSON en el directorio de configuración. Las API keys
//! NO viven aquí: van a la base de datos local (`db/`, `ai/sqlite.rs`).

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::events::UiAction;
use crate::keep_awake::KeepAwakeSetting;
use crate::stt::catalog::SttModel;
use crate::stt::SttLanguage;

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Oculta la isla de la pantalla compartida (por defecto ON, §3.3).
    pub hide_from_screen_share: bool,
    pub island_anchor: IslandAnchor,
    /// Esquina superior izquierda de la ventana en modo libre.
    pub free_origin: Option<Point>,
    /// ¿Ya se le pidió al usuario el permiso para capturar el audio del sistema? macOS no dice si
    /// un permiso está "denegado" o "sin pedir": hay que recordarlo para mostrar el mensaje justo.
    pub screen_capture_prompted: bool,
    /// Idioma de la transcripción: automático o uno fijo.
    pub stt_language: SttLanguage,
    /// Modelo de voz que se usa (`small` hasta que el usuario elija otro).
    pub stt_model: SttModel,
    /// Atajos globales que el usuario cambió (los que no están aquí usan el de por defecto).
    pub shortcuts: HashMap<UiAction, String>,
    /// Carpeta del modelo de voz que el usuario eligió; `None` = la carpeta de datos de la app.
    pub model_dir: Option<PathBuf>,
    /// ¿Ya terminó (o saltó) la guía de primer arranque?
    pub onboarding_done: bool,
    /// Modo de pantalla encendida (apagado, siempre, un tiempo o un horario diario).
    pub keep_awake: KeepAwakeSetting,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hide_from_screen_share: true,
            island_anchor: IslandAnchor::Center,
            free_origin: None,
            screen_capture_prompted: false,
            stt_language: SttLanguage::Auto,
            stt_model: SttModel::Small,
            shortcuts: HashMap::new(),
            model_dir: None,
            onboarding_done: false,
            keep_awake: KeepAwakeSetting::Off,
        }
    }
}

impl Settings {
    /// Los ajustes con los que arranca la app: la isla siempre nace centrada. La posición libre
    /// guardada se conserva para cuando el usuario vuelva a elegir "libre".
    pub fn for_startup(mut self) -> Self {
        self.island_anchor = IslandAnchor::Center;
        self
    }

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
    fn the_island_always_starts_centered_but_keeps_the_free_position() {
        let saved = Settings {
            island_anchor: IslandAnchor::Right,
            free_origin: Some(Point { x: 300.0, y: 80.0 }),
            ..Settings::default()
        };
        let startup = saved.for_startup();
        assert_eq!(startup.island_anchor, IslandAnchor::Center);
        assert_eq!(startup.free_origin, Some(Point { x: 300.0, y: 80.0 }));
        assert_eq!(startup.clone().for_startup(), startup, "idempotente");
    }

    #[test]
    fn roundtrips_through_disk() {
        let path = temp_path("roundtrip");
        let settings = Settings {
            hide_from_screen_share: false,
            island_anchor: IslandAnchor::Free,
            free_origin: Some(Point { x: 120.5, y: 40.0 }),
            screen_capture_prompted: true,
            stt_language: SttLanguage::Es,
            stt_model: SttModel::Turbo,
            shortcuts: HashMap::from([(UiAction::ToggleIsland, "Alt+Space".to_owned())]),
            model_dir: Some(PathBuf::from("/Volumes/Externo/modelos")),
            onboarding_done: true,
            keep_awake: KeepAwakeSetting::Schedule {
                start: 840,
                end: 1020,
            },
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
    fn the_transcription_language_defaults_to_automatic_and_survives_a_restart() {
        assert_eq!(Settings::default().stt_language, SttLanguage::Auto);

        let path = temp_path("language");
        fs::write(&path, r#"{ "sttLanguage": "en" }"#).unwrap();
        assert_eq!(Settings::load(&path).stt_language, SttLanguage::En);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn the_voice_model_defaults_to_small_so_existing_installs_keep_theirs() {
        assert_eq!(Settings::default().stt_model, SttModel::Small);

        let path = temp_path("model");
        // Un archivo de antes de poder elegir modelo no trae el campo.
        fs::write(&path, r#"{ "sttLanguage": "es" }"#).unwrap();
        assert_eq!(Settings::load(&path).stt_model, SttModel::Small);
        fs::write(&path, r#"{ "sttModel": "medium" }"#).unwrap();
        assert_eq!(Settings::load(&path).stt_model, SttModel::Medium);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn keep_awake_defaults_to_off_and_survives_a_restart() {
        assert_eq!(Settings::default().keep_awake, KeepAwakeSetting::Off);

        let path = temp_path("awake");
        // Un archivo de antes de existir el módulo no trae el campo.
        fs::write(&path, r#"{ "sttLanguage": "es" }"#).unwrap();
        assert_eq!(Settings::load(&path).keep_awake, KeepAwakeSetting::Off);
        fs::write(&path, r#"{ "keepAwake": { "mode": "always" } }"#).unwrap();
        assert_eq!(Settings::load(&path).keep_awake, KeepAwakeSetting::Always);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn a_new_install_has_default_shortcuts_the_app_folder_and_no_guide_seen() {
        let settings = Settings::default();
        assert!(settings.shortcuts.is_empty());
        assert_eq!(settings.model_dir, None);
        assert!(!settings.onboarding_done);
    }

    #[test]
    fn changed_shortcuts_are_keyed_by_action_name() {
        let path = temp_path("shortcuts");
        fs::write(
            &path,
            r#"{ "shortcuts": { "toggleQuestion": "Alt+Q" }, "onboardingDone": true }"#,
        )
        .unwrap();
        let settings = Settings::load(&path);
        assert_eq!(
            settings
                .shortcuts
                .get(&UiAction::ToggleQuestion)
                .map(String::as_str),
            Some("Alt+Q")
        );
        assert!(settings.onboarding_done);
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
        assert_eq!(json["sttLanguage"], "auto");
        assert_eq!(json["sttModel"], "small");
        assert_eq!(json["shortcuts"], serde_json::json!({}));
        assert!(json["modelDir"].is_null());
        assert_eq!(json["onboardingDone"], false);
        assert_eq!(json["keepAwake"], serde_json::json!({ "mode": "off" }));
        assert!(json["freeOrigin"].is_null());
    }
}
