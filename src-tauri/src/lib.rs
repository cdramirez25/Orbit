//! Orbit — composition root.
//!
//! Único lugar donde se eligen e instancian las implementaciones concretas (adaptadores) y se
//! inyectan en el núcleo (arquitectura hexagonal, §4.0). Elegir SO o proveedor = elegir otro
//! adaptador aquí; el núcleo no cambia.

mod ai;
mod app_state;
mod audio;
mod clipboard;
mod commands;
mod db;
mod events;
mod media;
mod pipeline;
mod sessions;
mod settings;
mod shortcuts;
mod stt;
mod tray;
mod weather;
mod window;

use std::path::PathBuf;
use std::sync::{Arc, PoisonError};
use std::time::Duration;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::ai::client::HttpLlm;
use crate::ai::prompter::{AnsweringSink, Prompter};
use crate::ai::recorder::QuestionRecorder;
use crate::ai::sqlite::SqliteAiStore;
use crate::ai::AiService;
use crate::app_state::{AppState, Services};
use crate::audio::permission::{status_of, AudioPermission};
use crate::audio::AudioSource;
use crate::clipboard::system::SystemClipboard;
use crate::clipboard::ClipboardService;
use crate::db::Db;
use crate::events::{DomainEvent, EventSink, PipelineState, TauriEventSink};
use crate::media::MediaService;
use crate::pipeline::{Pipeline, PipelineConfig};
use crate::sessions::sqlite::SqliteSessionStore;
use crate::sessions::SessionService;
use crate::settings::Settings;
use crate::stt::catalog::SttModel;
use crate::stt::location::ModelLocation;
use crate::stt::model::{ModelService, ModelSpec};
use crate::stt::model_source::HttpModelSource;
use crate::stt::whisper_local::WhisperEngine;
use crate::stt::SttEngine;
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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::ai::ai_get_status,
            commands::ai::ai_save_provider,
            commands::ai::ai_set_active,
            commands::ai::ai_test_provider,
            commands::ai::ai_list_models,
            commands::ai::ai_ask,
            commands::sessions::session_get_state,
            commands::sessions::session_create,
            commands::sessions::session_update,
            commands::sessions::session_delete,
            commands::sessions::session_set_active,
            commands::sessions::session_messages,
            commands::sessions::session_clear,
            commands::sessions::question_start,
            commands::sessions::question_finish,
            commands::sessions::question_cancel,
            commands::sessions::question_is_recording,
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
            commands::media::get_now_playing,
            commands::media::media_command,
            commands::media::media_seek,
            commands::island::get_notch_info,
            commands::island::set_island_interactive,
            commands::island::set_island_keyboard,
            commands::island::get_pointer_position,
            commands::island::set_content_protected,
            commands::island::get_island_settings,
            commands::island::set_island_anchor,
            commands::island::get_island_origin,
            commands::island::set_island_origin,
            commands::island::quit_app,
            commands::settings_window::open_settings_window,
            commands::stt::stt_model_status,
            commands::stt::stt_model_download,
            commands::stt::stt_model_cancel,
            commands::stt::stt_model_remove,
            commands::stt::stt_model_use,
            commands::stt::stt_model_choose_dir,
            commands::stt::stt_model_reset_dir,
            commands::stt::set_stt_language,
            commands::desktop::get_shortcuts,
            commands::desktop::set_shortcut,
            commands::desktop::reset_shortcut,
            commands::desktop::set_tray_labels,
            commands::desktop::get_autostart,
            commands::desktop::set_autostart,
            commands::desktop::set_onboarding_done,
        ])
        .setup(|app| {
            window::prepare_app(app)?;

            // Ajustes persistidos (posición de la isla, ocultar de screen share…).
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let loaded = Settings::load(&settings_path);
            let settings = loaded.clone().for_startup();
            if settings != loaded {
                if let Err(error) = settings.save(&settings_path) {
                    tracing::warn!(%error, "no se pudo guardar el ajuste de arranque");
                }
            }

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

            // Transcripción local (Whisper): los modelos viven en la carpeta de datos de la app (se
            // descargan desde Ajustes o la guía) y el elegido se carga al empezar a escuchar.
            let model_location = Arc::new(ModelLocation::new(
                app.path().app_data_dir()?.join("models"),
                settings.model_dir.clone(),
                settings.stt_model,
            ));
            let whisper = Arc::new(WhisperEngine::new(Arc::clone(&model_location)));
            whisper.set_language(settings.stt_language);
            let primer = Arc::clone(&whisper);
            std::thread::spawn(move || primer.prime_disk_cache());
            let stt: Arc<dyn SttEngine> = whisper;
            let model_specs = SttModel::ALL
                .iter()
                .map(|&model| ModelSpec {
                    model,
                    expected: model.expected(),
                    source: Arc::new(HttpModelSource::for_model(model)),
                })
                .collect();
            let models = Arc::new(ModelService::new(
                model_location,
                model_specs,
                Arc::clone(&events),
            ));

            // Base de datos local (SQLite, `orbit.db` en la carpeta de la app). Guarda las claves y la
            // configuración de la IA. Si no se puede abrir, Orbit sigue funcionando con una base en
            // memoria (lo que se guarde se pierde al cerrar).
            let db = match Db::open(&app.path().app_config_dir()?.join("orbit.db")) {
                Ok(db) => db,
                Err(error) => {
                    tracing::warn!(%error, "no se pudo abrir la base de datos; se usa una en memoria");
                    Db::open_in_memory()?
                }
            };
            // IA: el Prompter contesta las preguntas que salgan de la transcripción (o que se
            // escriban en Ajustes) con el proveedor que el usuario eligió.
            let ai = Arc::new(AiService::new(
                Box::new(SqliteAiStore::new(db.clone())),
                Box::new(HttpLlm::new()),
                Box::new(SqliteAiStore::new(db.clone())),
            ));
            let sessions = Arc::new(SessionService::new(Box::new(SqliteSessionStore::new(
                db.clone(),
            ))));
            let prompter = Arc::new(Prompter::new(
                Arc::clone(&ai),
                Arc::clone(&sessions),
                Arc::clone(&events),
            ));
            let recorder = Arc::new(QuestionRecorder::default());
            let pipeline_events: Arc<dyn EventSink> = Arc::new(AnsweringSink::new(
                Arc::clone(&events),
                Arc::clone(&prompter),
                Arc::clone(&recorder),
            ));
            let pipeline =
                Pipeline::new(audio_source, pipeline_events, config).with_stt(Arc::clone(&stt));

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

            // Música: lo que suena y sus controles, con el adaptador del sistema (macOS / Windows).
            let media = Arc::new(MediaService::new(
                Box::new(media::platform::current::SystemMedia::new()),
                Arc::clone(&events),
            ));
            media::spawn_monitor(Arc::clone(&media));

            app.manage(AppState::new(
                events,
                Services {
                    audio_permission,
                    pipeline,
                    weather,
                    clipboard,
                    media,
                    ai,
                    prompter,
                    sessions,
                    recorder,
                    stt,
                    models,
                },
                settings.clone(),
                settings_path,
            ));
            app.manage(tray::TrayState::default());
            shortcuts::register(app.handle(), &settings.shortcuts);

            window::island_window::create(app.handle(), &settings)?;
            window::island_window::spawn_display_watcher(app.handle().clone());

            // La ventana de ajustes se abre sola al arrancar en desarrollo, y en la primera vez (donde
            // muestra la guía de primer arranque). Se puede cerrar y volver a abrir con el engranaje
            // de la isla o desde la bandeja.
            if cfg!(debug_assertions) || !settings.onboarding_done {
                window::settings_window::open(app.handle(), settings.hide_from_screen_share)?;
            }

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
