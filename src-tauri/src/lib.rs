//! Orbit — composition root.
//!
//! Único lugar donde se eligen e instancian las implementaciones concretas (adaptadores) y se
//! inyectan en el núcleo (arquitectura hexagonal, §4.0). Elegir SO o proveedor = elegir otro
//! adaptador aquí; el núcleo no cambia.

mod app_state;
mod audio;
mod commands;
mod events;
mod settings;
mod window;

use std::sync::Arc;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::app_state::AppState;
use crate::audio::permission::{status_of, AudioPermission};
use crate::events::{DomainEvent, EventSink, PipelineState, TauriEventSink};
use crate::settings::Settings;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("orbit_lib=info")),
        )
        .init();

    let result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::audio::get_audio_permission,
            commands::audio::request_audio_permission,
            commands::audio::open_audio_permission_settings,
            commands::island::get_notch_info,
            commands::island::set_island_interactive,
            commands::island::get_pointer_position,
            commands::island::set_content_protected,
            commands::island::get_island_settings,
            commands::island::set_island_anchor,
            commands::island::get_island_origin,
            commands::island::set_island_origin,
            commands::island::quit_app,
        ])
        .setup(|app| {
            window::prepare_app(app)?;

            // Ajustes persistidos (posición de la isla, ocultar de screen share…).
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let settings = Settings::load(&settings_path);

            // Adaptadores de salida (eventos hacia la interfaz) y del sistema (permiso de audio).
            let events: Arc<dyn EventSink> = Arc::new(TauriEventSink::new(app.handle().clone()));
            let audio_permission: Arc<dyn AudioPermission> =
                Arc::new(audio::platform::current::SystemAudioPermission);

            tracing::info!(
                status = ?status_of(audio_permission.as_ref(), settings.screen_capture_prompted),
                "permiso para capturar el audio del sistema"
            );

            app.manage(AppState::new(
                events,
                audio_permission,
                settings,
                settings_path,
            ));

            window::island_window::create(app.handle(), &settings)?;
            window::island_window::spawn_display_watcher(app.handle().clone());

            app.state::<AppState>()
                .events
                .publish(DomainEvent::PipelineState(PipelineState::Idle));

            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        tracing::error!(%error, "Orbit terminó con un error");
        std::process::exit(1);
    }
}
