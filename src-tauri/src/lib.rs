//! Orbit — composition root.
//!
//! Único lugar donde se eligen e instancian las implementaciones concretas (adaptadores) y se
//! inyectan en el núcleo (arquitectura hexagonal, §4.0). Elegir SO o proveedor = elegir otro
//! adaptador aquí; el núcleo no cambia.

mod app_state;
mod commands;
mod events;
mod settings;
mod window;

use std::sync::Arc;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::app_state::AppState;
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

            // Adaptador de salida de eventos → núcleo.
            let events: Arc<dyn EventSink> = Arc::new(TauriEventSink::new(app.handle().clone()));
            app.manage(AppState::new(events, settings, settings_path));

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
