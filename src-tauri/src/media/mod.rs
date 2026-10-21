//! Música: lo que suena ahora en el sistema (título, artista, si está sonando) y los controles
//! básicos (play, pausa, anterior, siguiente). Sirve para cualquier reproductor que se anuncie al
//! sistema, navegadores incluidos (YouTube, Udemy…).
//!
//! El núcleo solo conoce el puerto `MediaPort`; los adaptadores de cada sistema viven en
//! `platform/` y los elige `lib.rs`. Nada de lo que suena se escribe en logs.

pub mod platform;

use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::events::{DomainEvent, EventSink};

/// Cada cuánto se revisa si cambió lo que suena (el adaptador solo lee lo que ya sabe).
const POLL_EVERY: Duration = Duration::from_millis(500);

/// Lo que suena ahora. Espejo de `NowPlaying` en `src/types/media.ts`.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: Option<String>,
    pub playing: bool,
    /// Portada como `data:image/...;base64,...` (la interfaz la usa tal cual en un `<img>`).
    pub artwork: Option<String>,
    /// Duración en segundos; `None` en un directo o si no se sabe (entonces no hay barra).
    pub duration: Option<f64>,
    /// Segundos reproducidos en el instante `position_at_ms`. Solo cambia al empezar la canción,
    /// pausar o adelantar: la interfaz calcula el resto mientras suena.
    pub position: Option<f64>,
    /// Cuándo (milisegundos Unix) valía `position`.
    pub position_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaCommand {
    Play,
    Pause,
    Toggle,
    Next,
    Previous,
}

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("no se pudo enviar la orden al reproductor: {0}")]
    Command(String),
}

impl MediaError {
    /// Código estable que la interfaz usa para elegir el mensaje (no depende del texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Command(_) => "media.command",
        }
    }
}

/// Puerto de la música del sistema. Cada sistema operativo tiene su adaptador.
pub trait MediaPort: Send + Sync {
    /// Lo que suena ahora, o `None` si no hay nada (o no se puede saber).
    fn now_playing(&self) -> Option<NowPlaying>;
    fn send(&self, command: MediaCommand) -> Result<(), MediaError>;
}

pub struct MediaService {
    port: Box<dyn MediaPort>,
    events: Arc<dyn EventSink>,
    current: Mutex<Option<NowPlaying>>,
}

impl MediaService {
    pub fn new(port: Box<dyn MediaPort>, events: Arc<dyn EventSink>) -> Self {
        Self {
            port,
            events,
            current: Mutex::new(None),
        }
    }

    fn current_guard(&self) -> std::sync::MutexGuard<'_, Option<NowPlaying>> {
        self.current.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Revisa lo que suena y, si cambió, avisa a la interfaz. Devuelve si hubo cambio.
    pub fn poll(&self) -> bool {
        let latest = self.port.now_playing();
        {
            let mut current = self.current_guard();
            if *current == latest {
                return false;
            }
            current.clone_from(&latest);
        }
        self.events.publish(DomainEvent::MediaChanged(latest));
        true
    }

    /// Lo que sonaba la última vez que se revisó.
    pub fn current(&self) -> Option<NowPlaying> {
        self.current_guard().clone()
    }

    pub fn send(&self, command: MediaCommand) -> Result<(), MediaError> {
        self.port.send(command)
    }
}

/// Hilo que revisa los cambios mientras Orbit esté abierto.
pub fn spawn_monitor(service: Arc<MediaService>) {
    let spawned = thread::Builder::new()
        .name("orbit-media".into())
        .spawn(move || loop {
            service.poll();
            thread::sleep(POLL_EVERY);
        });
    if let Err(error) = spawned {
        tracing::warn!(%error, "no se pudo iniciar el monitor de la música");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::testing::FakeEventSink;

    #[derive(Default)]
    struct FakePort {
        playing: Mutex<Option<NowPlaying>>,
        sent: Mutex<Vec<MediaCommand>>,
        fails: Mutex<bool>,
    }

    impl FakePort {
        fn set(&self, value: Option<NowPlaying>) {
            *self.playing.lock().unwrap() = value;
        }
    }

    impl MediaPort for Arc<FakePort> {
        fn now_playing(&self) -> Option<NowPlaying> {
            self.playing.lock().unwrap().clone()
        }
        fn send(&self, command: MediaCommand) -> Result<(), MediaError> {
            if *self.fails.lock().unwrap() {
                return Err(MediaError::Command("falla".into()));
            }
            self.sent.lock().unwrap().push(command);
            Ok(())
        }
    }

    fn track(title: &str, playing: bool) -> NowPlaying {
        NowPlaying {
            title: title.into(),
            artist: Some("Artista".into()),
            playing,
            ..NowPlaying::default()
        }
    }

    fn service() -> (Arc<FakePort>, Arc<FakeEventSink>, MediaService) {
        let port = Arc::new(FakePort::default());
        let events = Arc::new(FakeEventSink::default());
        let service = MediaService::new(Box::new(Arc::clone(&port)), events.clone());
        (port, events, service)
    }

    #[test]
    fn nothing_playing_is_not_a_change() {
        let (_, events, service) = service();
        assert!(!service.poll());
        assert_eq!(service.current(), None);
        assert!(events.events().is_empty());
    }

    #[test]
    fn a_new_track_is_published_once() {
        let (port, events, service) = service();
        port.set(Some(track("Canción", true)));

        assert!(service.poll());
        assert!(!service.poll(), "sin cambios no se vuelve a avisar");
        assert_eq!(service.current(), Some(track("Canción", true)));
        assert_eq!(
            events.events(),
            vec![DomainEvent::MediaChanged(Some(track("Canción", true)))]
        );
    }

    #[test]
    fn pausing_changing_and_stopping_are_all_changes() {
        let (port, events, service) = service();
        port.set(Some(track("A", true)));
        service.poll();

        port.set(Some(track("A", false)));
        assert!(service.poll());
        port.set(Some(track("B", true)));
        assert!(service.poll());
        port.set(None);
        assert!(service.poll());

        assert_eq!(service.current(), None);
        assert_eq!(events.events().len(), 4);
        assert_eq!(
            events.events().last(),
            Some(&DomainEvent::MediaChanged(None))
        );
    }

    #[test]
    fn commands_reach_the_player() {
        let (port, _, service) = service();
        service.send(MediaCommand::Next).unwrap();
        service.send(MediaCommand::Toggle).unwrap();
        assert_eq!(
            *port.sent.lock().unwrap(),
            vec![MediaCommand::Next, MediaCommand::Toggle]
        );
    }

    #[test]
    fn a_failing_command_is_an_error_with_a_stable_code() {
        let (port, _, service) = service();
        *port.fails.lock().unwrap() = true;
        let error = service.send(MediaCommand::Play).unwrap_err();
        assert_eq!(error.code(), "media.command");
    }

    #[test]
    fn commands_come_from_the_interface_in_lowercase() {
        let command: MediaCommand = serde_json::from_str("\"previous\"").unwrap();
        assert_eq!(command, MediaCommand::Previous);
        assert!(serde_json::from_str::<MediaCommand>("\"Reboot\"").is_err());
    }

    #[test]
    fn the_track_serializes_in_camel_case() {
        let mut now = track("T", true);
        now.duration = Some(180.0);
        now.position = Some(12.5);
        now.position_at_ms = Some(1_000);
        let value = serde_json::to_value(now).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "title": "T",
                "artist": "Artista",
                "playing": true,
                "artwork": null,
                "duration": 180.0,
                "position": 12.5,
                "positionAtMs": 1000,
            })
        );
    }
}
