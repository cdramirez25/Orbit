//! Estado compartido de la app. Se construye en el composition root (`lib.rs`).

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use crate::ai::AiService;
use crate::audio::permission::AudioPermission;
use crate::clipboard::ClipboardService;
use crate::events::EventSink;
use crate::media::MediaService;
use crate::pipeline::Pipeline;
use crate::settings::Settings;
use crate::weather::WeatherService;

pub struct AppState {
    /// Puerto de salida de eventos de dominio; el adaptador concreto lo elige `lib.rs`.
    pub events: Arc<dyn EventSink>,
    /// Puerto del permiso de audio del sistema; el adaptador (macOS / Windows) lo elige `lib.rs`.
    pub audio_permission: Arc<dyn AudioPermission>,
    /// Orquestador de la escucha (audio → volumen → eventos). Un solo hilo a la vez lo opera.
    pub pipeline: Mutex<Pipeline>,
    /// Clima de la zona del usuario (módulo Clima de la isla).
    pub weather: Arc<WeatherService>,
    /// Historial del portapapeles de esta sesión (módulo Portapapeles de la isla).
    pub clipboard: Arc<ClipboardService>,
    /// Lo que suena y sus controles (módulo Música de la isla).
    pub media: Arc<MediaService>,
    /// Proveedores de IA, sus claves (en el llavero) y las respuestas del Prompter.
    pub ai: Arc<AiService>,
    settings: RwLock<Settings>,
    settings_path: PathBuf,
}

/// Los servicios de la app ya construidos con sus adaptadores (los elige `lib.rs`).
pub struct Services {
    pub audio_permission: Arc<dyn AudioPermission>,
    pub pipeline: Pipeline,
    pub weather: Arc<WeatherService>,
    pub clipboard: Arc<ClipboardService>,
    pub media: Arc<MediaService>,
    pub ai: Arc<AiService>,
}

impl AppState {
    pub fn new(
        events: Arc<dyn EventSink>,
        services: Services,
        settings: Settings,
        settings_path: PathBuf,
    ) -> Self {
        Self {
            events,
            audio_permission: services.audio_permission,
            pipeline: Mutex::new(services.pipeline),
            weather: services.weather,
            clipboard: services.clipboard,
            media: services.media,
            ai: services.ai,
            settings: RwLock::new(settings),
            settings_path,
        }
    }

    pub fn settings(&self) -> Settings {
        match self.settings.read() {
            Ok(guard) => *guard,
            Err(poisoned) => *poisoned.into_inner(),
        }
    }

    /// Aplica un cambio, lo guarda en disco y devuelve los ajustes resultantes.
    pub fn update_settings(&self, change: impl FnOnce(&mut Settings)) -> Settings {
        let updated = {
            let mut guard = match self.settings.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            change(&mut guard);
            *guard
        };
        if let Err(error) = updated.save(&self.settings_path) {
            tracing::warn!(%error, "no se pudieron guardar los ajustes");
        }
        updated
    }
}
