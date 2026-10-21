//! Estado compartido de la app. Se construye en el composition root (`lib.rs`).

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use crate::audio::permission::AudioPermission;
use crate::events::EventSink;
use crate::pipeline::Pipeline;
use crate::settings::Settings;

pub struct AppState {
    /// Puerto de salida de eventos de dominio; el adaptador concreto lo elige `lib.rs`.
    pub events: Arc<dyn EventSink>,
    /// Puerto del permiso de audio del sistema; el adaptador (macOS / Windows) lo elige `lib.rs`.
    pub audio_permission: Arc<dyn AudioPermission>,
    /// Orquestador de la escucha (audio → volumen → eventos). Un solo hilo a la vez lo opera.
    pub pipeline: Mutex<Pipeline>,
    settings: RwLock<Settings>,
    settings_path: PathBuf,
}

impl AppState {
    pub fn new(
        events: Arc<dyn EventSink>,
        audio_permission: Arc<dyn AudioPermission>,
        pipeline: Pipeline,
        settings: Settings,
        settings_path: PathBuf,
    ) -> Self {
        Self {
            events,
            audio_permission,
            pipeline: Mutex::new(pipeline),
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
