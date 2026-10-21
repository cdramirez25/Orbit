//! Orbit — composition root.
//!
//! Único lugar donde se eligen e instancian las implementaciones concretas (adaptadores) y se
//! inyectan en el núcleo (arquitectura hexagonal, §4.0). Elegir SO o proveedor = elegir otro
//! adaptador aquí; el núcleo no cambia.

mod app_state;
mod audio;
mod clipboard;
mod commands;
mod events;
mod pipeline;
mod settings;
mod weather;
mod window;

use std::path::PathBuf;
use std::sync::{Arc, PoisonError};
use std::time::Duration;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::app_state::AppState;
use crate::audio::permission::{status_of, AudioPermission};
use crate::audio::AudioSource;
use crate::clipboard::system::SystemClipboard;
use crate::clipboard::ClipboardService;
use crate::events::{DomainEvent, EventSink, PipelineState, TauriEventSink};
use crate::pipeline::{Pipeline, PipelineConfig};
use crate::settings::Settings;
use crate::weather::ip_locator::IpLocator;
use crate::weather::open_meteo::OpenMeteo;
use crate::weather::WeatherService;

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
            commands::pipeline::start_listening,
            commands::pipeline::stop_listening,
            commands::pipeline::is_listening,
            commands::weather::get_weather,
            commands::clipboard::get_clipboard_history,
            commands::clipboard::copy_clipboard_entry,
            commands::clipboard::delete_clipboard_entry,
            commands::clipboard::clear_clipboard_history,
            commands::island::get_notch_info,
            commands::island::set_island_interactive,
            commands::island::get_pointer_position,
            commands::island::set_content_protected,
            commands::island::get_island_settings,
            commands::island::set_island_anchor,
            commands::island::get_island_origin,
            commands::island::set_island_origin,
            commands::island::quit_app,
            commands::settings_window::open_settings_window,
        ])
        .setup(|app| {
            window::prepare_app(app)?;

            // Ajustes persistidos (posición de la isla, ocultar de screen share…).
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let settings = Settings::load(&settings_path);

            // Adaptadores de salida (eventos hacia la interfaz) y del sistema (audio).
            let events: Arc<dyn EventSink> = Arc::new(TauriEventSink::new(app.handle().clone()));
            let audio_permission: Arc<dyn AudioPermission> =
                Arc::new(audio::platform::current::SystemAudioPermission);
            let audio_source: Box<dyn AudioSource> =
                Box::new(audio::platform::current::SystemAudioSource::new());

            tracing::info!(
                status = ?status_of(audio_permission.as_ref(), settings.screen_capture_prompted),
                "permiso para capturar el audio del sistema"
            );

            // DEPURACIÓN: con ORBIT_DEBUG_WAV=<ruta> el audio normalizado se guarda en un WAV.
            let config = PipelineConfig {
                debug_wav: std::env::var_os("ORBIT_DEBUG_WAV").map(PathBuf::from),
            };
            let pipeline = Pipeline::new(audio_source, Arc::clone(&events), config);

            // Clima: ubicación por IP (ipwho.is) + datos de Open-Meteo, con un solo cliente HTTP.
            let http = weather::http::agent();
            let weather = Arc::new(WeatherService::new(
                Box::new(IpLocator::new(http.clone())),
                Box::new(OpenMeteo::new(http)),
            ));

            // Portapapeles: el historial vive solo en memoria y un hilo vigila los cambios.
            let clipboard = Arc::new(ClipboardService::new(
                Box::new(SystemClipboard::new()),
                Arc::clone(&events),
            ));
            clipboard::spawn_monitor(Arc::clone(&clipboard));

            app.manage(AppState::new(
                events,
                audio_permission,
                pipeline,
                weather,
                clipboard,
                settings,
                settings_path,
            ));

            window::island_window::create(app.handle(), &settings)?;
            window::island_window::spawn_display_watcher(app.handle().clone());

            // Solo en desarrollo: la ventana de ajustes se abre sola al arrancar. Se puede cerrar y
            // volver a abrir con el engranaje de la isla.
            #[cfg(debug_assertions)]
            window::settings_window::open(app.handle(), settings.hide_from_screen_share)?;

            app.state::<AppState>()
                .events
                .publish(DomainEvent::PipelineState(PipelineState::Idle));

            // DEPURACIÓN: ORBIT_DEBUG_AUTOSTART=1 empieza a escuchar solo, para probar la captura
            // sin pulsar nada. Espera a que la interfaz esté lista para recibir los eventos.
            if std::env::var_os("ORBIT_DEBUG_AUTOSTART").is_some() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(2));
                    let state = handle.state::<AppState>();
                    let mut pipeline = state
                        .pipeline
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner);
                    if let Err(error) = pipeline.start() {
                        tracing::warn!(%error, "no se pudo empezar a escuchar (autostart)");
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        tracing::error!(%error, "Orbit terminó con un error");
        std::process::exit(1);
    }
}
