//! macOS: lo que suena y los controles salen del "Now Playing" del sistema (MediaRemote), el mismo
//! que alimenta el Centro de control. Es un framework PRIVADO: desde macOS 15.4 solo deja usarlo a
//! procesos de Apple, así que Orbit se apoya en `/usr/bin/perl`, que sí puede: `macos/media.pl` carga
//! `macos/orbit_media.m` (la compila `build.rs`) y llama a sus funciones desde dentro de perl.
//!
//! - **Leer:** un proceso perl que vive mientras Orbit y escribe una línea cada vez que cambia lo que
//!   suena. Mira todos los reproductores (no solo el "activo" del sistema, que a veces es una
//!   pestaña vieja en pausa) y elige el que suena.
//! - **Controlar:** un perl de un solo uso que manda la orden a la app que se está mostrando.
//!
//! Puede dejar de funcionar si Apple cierra esa puerta en una actualización; verificar a mano.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;

use crate::media::{MediaCommand, MediaError, MediaPort, NowPlaying};

const MEDIA_SCRIPT: &str = include_str!("macos/media.pl");
/// Ruta de la biblioteca de `orbit_media.m` compilada por `build.rs`.
// TODO(Fase 6): al empaquetar la app hay que copiarla a Resources y buscarla ahí.
const LIBRARY: &str = env!("ORBIT_MEDIA_DYLIB");
/// Si el proceso lector termina, se vuelve a lanzar pasado este tiempo.
const RESTART_AFTER: Duration = Duration::from_secs(5);

/// Lo que escribe el lector en cada línea (o `null`).
#[derive(Deserialize)]
struct Line {
    title: String,
    artist: Option<String>,
    playing: bool,
    /// Bundle id de la app que reproduce (por ejemplo, el navegador).
    client: String,
    artwork: Option<String>,
    duration: Option<f64>,
    position: Option<f64>,
}

/// Lo que suena y en qué app, para mandarle las órdenes a esa y no a otra.
#[derive(Debug, Clone, PartialEq)]
struct Reading {
    now: NowPlaying,
    client: String,
}

/// Una línea del lector → lo que suena. `received_at_ms` es cuándo llegó la línea (la posición se
/// midió justo antes). Cualquier cosa rara cuenta como "nada suena".
fn parse_line(line: &str, received_at_ms: u64) -> Option<Reading> {
    let line: Line = serde_json::from_str::<Option<Line>>(line).ok().flatten()?;
    if line.title.trim().is_empty() || line.client.trim().is_empty() {
        return None;
    }
    // Sin duración no hay barra de progreso, y entonces la posición no sirve de nada.
    let duration = line.duration.filter(|duration| *duration > 0.0);
    let position = duration.and(line.position);
    Some(Reading {
        now: NowPlaying {
            title: line.title,
            artist: line.artist.filter(|artist| !artist.trim().is_empty()),
            playing: line.playing,
            artwork: line
                .artwork
                .filter(|artwork| artwork.starts_with("data:image/")),
            duration,
            position,
            position_at_ms: position.map(|_| received_at_ms),
        },
        client: line.client,
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(0))
}

/// "Saltar a una posición" en MediaRemote (`SeekToPlaybackPosition`); la posición va aparte, en
/// segundos, en las opciones de la orden. Número confirmado con `MRMediaRemoteCopyCommandDescription`.
const SEEK_COMMAND: u8 = 24;

/// Número de la orden en MediaRemote (`MRCommand`).
fn command_number(command: MediaCommand) -> u8 {
    match command {
        MediaCommand::Play => 0,
        MediaCommand::Pause => 1,
        MediaCommand::Toggle => 2,
        MediaCommand::Next => 4,
        MediaCommand::Previous => 5,
    }
}

type SharedState = Arc<Mutex<Option<Reading>>>;

fn set(state: &Mutex<Option<Reading>>, value: Option<Reading>) {
    *state.lock().unwrap_or_else(PoisonError::into_inner) = value;
}

/// Lanza el lector y procesa sus líneas hasta que termina.
fn run_reader(state: &Mutex<Option<Reading>>) -> std::io::Result<()> {
    let mut child = Command::new("/usr/bin/perl")
        .args(["-e", MEDIA_SCRIPT, LIBRARY, "orbit_media_watch"])
        .env("ORBIT_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines() {
            set(state, parse_line(&line?, now_ms()));
        }
    }
    child.wait()?;
    Ok(())
}

pub struct SystemMedia {
    state: SharedState,
}

impl SystemMedia {
    pub fn new() -> Self {
        let state: SharedState = Arc::new(Mutex::new(None));
        let shared = Arc::clone(&state);
        let spawned = thread::Builder::new()
            .name("orbit-media-reader".into())
            .spawn(move || loop {
                if let Err(error) = run_reader(&shared) {
                    tracing::warn!(%error, "el lector de la música falló");
                }
                set(&shared, None);
                thread::sleep(RESTART_AFTER);
            });
        if let Err(error) = spawned {
            tracing::warn!(%error, "no se pudo iniciar el lector de la música");
        }
        Self { state }
    }
}

impl SystemMedia {
    fn reading(&self) -> Option<Reading> {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl Default for SystemMedia {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaPort for SystemMedia {
    fn now_playing(&self) -> Option<NowPlaying> {
        self.reading().map(|reading| reading.now)
    }

    fn send(&self, command: MediaCommand) -> Result<(), MediaError> {
        self.run_command(command_number(command), None)
    }

    fn seek(&self, position: f64) -> Result<(), MediaError> {
        self.run_command(SEEK_COMMAND, Some(position))
    }
}

impl SystemMedia {
    /// Manda una orden de MediaRemote a la app que se está mostrando, no al reproductor "activo"
    /// del sistema. `position` solo se usa en el salto.
    fn run_command(&self, number: u8, position: Option<f64>) -> Result<(), MediaError> {
        let reading = self
            .reading()
            .ok_or_else(|| MediaError::Command("no hay nada sonando".into()))?;
        let mut command = Command::new("/usr/bin/perl");
        command
            .args(["-e", MEDIA_SCRIPT, LIBRARY, "orbit_media_send"])
            .env("ORBIT_MEDIA_COMMAND", number.to_string())
            .env("ORBIT_MEDIA_CLIENT", &reading.client)
            .stdin(Stdio::null());
        if let Some(position) = position {
            command.env("ORBIT_MEDIA_POSITION", position.to_string());
        }
        let output = command
            .output()
            .map_err(|error| MediaError::Command(error.to_string()))?;
        if output.status.success() {
            Ok(())
        } else {
            // Los mensajes de la biblioteca son nuestros: no llevan nada de lo que suena.
            Err(MediaError::Command(
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(title: &str, artist: &str, playing: bool, client: &str) -> String {
        format!(
            r#"{{"title":"{title}","artist":{artist},"playing":{playing},"client":"{client}"}}"#
        )
    }

    #[test]
    fn a_reader_line_becomes_the_current_track_and_remembers_the_app() {
        let reading = parse_line(
            &line("Canción", r#""Artista""#, true, "com.brave.Browser"),
            5,
        );
        assert_eq!(
            reading,
            Some(Reading {
                now: NowPlaying {
                    title: "Canción".into(),
                    artist: Some("Artista".into()),
                    playing: true,
                    ..NowPlaying::default()
                },
                client: "com.brave.Browser".into()
            })
        );
    }

    #[test]
    fn duration_position_and_artwork_come_through() {
        let json = r#"{"title":"T","artist":null,"playing":true,"client":"app.x","duration":200.5,"position":42.25,"artwork":"data:image/jpeg;base64,AAAA"}"#;
        let now = parse_line(json, 1234).unwrap().now;
        assert_eq!(now.duration, Some(200.5));
        assert_eq!(now.position, Some(42.25));
        assert_eq!(now.position_at_ms, Some(1234));
        assert_eq!(now.artwork.as_deref(), Some("data:image/jpeg;base64,AAAA"));
    }

    #[test]
    fn without_a_duration_there_is_no_progress_bar() {
        for json in [
            r#"{"title":"T","artist":null,"playing":true,"client":"app.x","duration":null,"position":10.0}"#,
            r#"{"title":"T","artist":null,"playing":true,"client":"app.x","duration":0.0,"position":10.0}"#,
        ] {
            let now = parse_line(json, 9).unwrap().now;
            assert_eq!(
                (now.duration, now.position, now.position_at_ms),
                (None, None, None)
            );
        }
    }

    #[test]
    fn artwork_that_is_not_an_image_is_dropped() {
        let json = r#"{"title":"T","artist":null,"playing":true,"client":"app.x","artwork":"javascript:alert(1)"}"#;
        assert_eq!(parse_line(json, 1).unwrap().now.artwork, None);
    }

    #[test]
    fn an_empty_artist_is_no_artist() {
        let reading = parse_line(&line("T", r#""""#, false, "app.x"), 0).unwrap();
        assert_eq!(reading.now.artist, None);
        let reading = parse_line(&line("T", "null", false, "app.x"), 0).unwrap();
        assert_eq!(reading.now.artist, None);
    }

    #[test]
    fn null_blank_titles_missing_app_and_garbage_mean_nothing_is_playing() {
        assert_eq!(parse_line("null", 0), None);
        assert_eq!(parse_line(&line("  ", "null", true, "app.x"), 0), None);
        assert_eq!(parse_line(&line("T", "null", true, " "), 0), None);
        assert_eq!(
            parse_line(r#"{"title":"T","artist":null,"playing":true}"#, 0),
            None,
            "sin la app no se podrían mandar órdenes"
        );
        assert_eq!(parse_line("no es json", 0), None);
        assert_eq!(parse_line("", 0), None);
    }

    #[test]
    fn commands_use_the_media_remote_numbers() {
        assert_eq!(command_number(MediaCommand::Play), 0);
        assert_eq!(command_number(MediaCommand::Pause), 1);
        assert_eq!(command_number(MediaCommand::Toggle), 2);
        assert_eq!(command_number(MediaCommand::Next), 4);
        assert_eq!(command_number(MediaCommand::Previous), 5);
        assert_eq!(SEEK_COMMAND, 24);
    }

    #[test]
    fn without_anything_playing_a_command_is_an_error() {
        let media = SystemMedia {
            state: Arc::new(Mutex::new(None)),
        };
        assert!(media.send(MediaCommand::Toggle).is_err());
        assert!(media.seek(30.0).is_err());
    }

    /// Arranca el lector real del sistema y comprueba que responde. No muestra lo que suena.
    /// `cargo test live_media -- --ignored`
    #[test]
    #[ignore = "usa perl y el Now Playing real del sistema"]
    fn live_media_reader_runs_and_reports() {
        let media = SystemMedia::new();
        std::thread::sleep(Duration::from_secs(4));
        let now = media.now_playing();
        eprintln!("something is playing: {}", now.is_some());
        if let Some(now) = now {
            eprintln!(
                "has artwork: {}, duration: {}, position: {}",
                now.artwork.is_some(),
                now.duration.is_some(),
                now.position.is_some()
            );
        }
    }

    /// Prueba manual con la música real: salta 10 s hacia delante, comprueba que el lector lo ve y
    /// la deja donde habría estado. Solo imprime números (nunca lo que suena). Si no suena nada, o
    /// no tiene duración, o está a punto de acabar, no hace nada.
    /// `cargo test live_media_seek -- --ignored --nocapture`
    #[test]
    #[ignore = "salta en la canción real que esté sonando y la deja donde estaba"]
    fn live_media_seek_moves_the_real_player_and_restores_it() {
        fn position_now(now: &NowPlaying) -> Option<f64> {
            let (position, at) = (now.position?, now.position_at_ms?);
            let elapsed = if now.playing {
                now_ms().saturating_sub(at) as f64 / 1000.0
            } else {
                0.0
            };
            Some(position + elapsed)
        }

        let media = SystemMedia::new();
        std::thread::sleep(Duration::from_secs(4));
        let Some(before) = media.now_playing() else {
            eprintln!("nothing is playing: skipped");
            return;
        };
        let (Some(duration), Some(start)) = (before.duration, position_now(&before)) else {
            eprintln!("no duration or position: skipped");
            return;
        };
        if start + 30.0 > duration {
            eprintln!("too close to the end: skipped");
            return;
        }

        let started = std::time::Instant::now();
        media.seek(start + 10.0).expect("the seek command failed");
        std::thread::sleep(Duration::from_secs(3));
        let after = media.now_playing().expect("still playing");
        let seen = position_now(&after).expect("position after the seek");
        let jumped = seen - start;
        eprintln!("seen jump: {jumped:.1} s (expected about 13: 10 plus 3 of playback)");

        // Se deja donde habría estado sin el salto.
        let elapsed = if before.playing {
            started.elapsed().as_secs_f64()
        } else {
            0.0
        };
        media.seek(start + elapsed).expect("the restore failed");
        assert!(jumped > 8.0, "the player did not move: {jumped:.1} s");
    }

    #[test]
    fn the_media_library_was_built() {
        assert!(std::path::Path::new(LIBRARY).exists());
    }
}
