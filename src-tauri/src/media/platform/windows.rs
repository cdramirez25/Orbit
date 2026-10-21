//! Windows: lo que suena y los controles salen de GSMTC (Global System Media Transport Controls),
//! la API oficial del sistema. La usan Spotify, el Reproductor de Windows y los navegadores
//! (YouTube, Udemy…). Verificar a mano en Windows.

use std::cell::Cell;
use std::sync::{Mutex, PoisonError};
use std::thread;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use windows::core::Result as WinResult;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as Properties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

use crate::media::{MediaCommand, MediaError, MediaPort, NowPlaying};

/// Una portada más grande que esto (en bytes) no se manda a la interfaz.
const MAX_ARTWORK_BYTES: u64 = 300_000;
/// Cuántas veces se intenta bajar la portada de una canción (a veces tarda en estar lista).
const ARTWORK_ATTEMPTS: u32 = 4;
/// Windows cuenta el tiempo en intervalos de 100 ns desde el 1 de enero de 1601.
const TICKS_PER_SECOND: f64 = 10_000_000.0;
const TICKS_PER_MILLISECOND: i64 = 10_000;
const UNIX_EPOCH_IN_TICKS: i64 = 116_444_736_000_000_000;

thread_local! {
    static WINRT_READY: Cell<bool> = const { Cell::new(false) };
}

/// Prepara WinRT en el hilo actual (una vez por hilo).
fn init_winrt() {
    WINRT_READY.with(|ready| {
        if !ready.get() {
            // SAFETY: `RoInitialize` no recibe punteros. Si el hilo ya tenía otro modo de COM
            // devuelve un error, que se ignora: WinRT sigue funcionando con el que tenga.
            let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
            ready.set(true);
        }
    });
}

fn current_session() -> WinResult<Session> {
    Manager::RequestAsync()?.join()?.GetCurrentSession()
}

/// La portada como `data:image/...;base64,...`, o `None` si no hay o es muy grande.
fn read_artwork(properties: &Properties) -> WinResult<Option<String>> {
    let stream = properties.Thumbnail()?.OpenReadAsync()?.join()?;
    let size = stream.Size()?;
    if size == 0 || size > MAX_ARTWORK_BYTES {
        return Ok(None);
    }
    let mime = stream.ContentType()?.to_string();
    if !mime.starts_with("image/") {
        return Ok(None);
    }
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    // `size` es como mucho `MAX_ARTWORK_BYTES`: cabe de sobra en un `u32` y en un `usize`.
    let length = size as u32;
    reader.LoadAsync(length)?.join()?;
    let mut bytes = vec![0u8; length as usize];
    reader.ReadBytes(&mut bytes)?;
    Ok(Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes))))
}

/// Duración, posición y el instante en que valía esa posición (ms Unix), si el reproductor los da.
fn read_timeline(session: &Session) -> WinResult<(Option<f64>, Option<f64>, Option<u64>)> {
    let timeline = session.GetTimelineProperties()?;
    let start = timeline.StartTime()?.Duration;
    let end = timeline.EndTime()?.Duration;
    let duration = (end - start) as f64 / TICKS_PER_SECOND;
    if duration <= 0.0 {
        return Ok((None, None, None));
    }
    let position = (timeline.Position()?.Duration - start) as f64 / TICKS_PER_SECOND;
    let updated_at = timeline.LastUpdatedTime()?.UniversalTime;
    let updated_at_ms = u64::try_from((updated_at - UNIX_EPOCH_IN_TICKS) / TICKS_PER_MILLISECOND).ok();
    Ok((Some(duration), updated_at_ms.map(|_| position), updated_at_ms))
}

/// `true` si el reproductor aceptó la orden.
fn run(command: MediaCommand) -> WinResult<bool> {
    let session = current_session()?;
    match command {
        MediaCommand::Play => session.TryPlayAsync()?.join(),
        MediaCommand::Pause => session.TryPauseAsync()?.join(),
        MediaCommand::Toggle => session.TryTogglePlayPauseAsync()?.join(),
        MediaCommand::Next => session.TrySkipNextAsync()?.join(),
        MediaCommand::Previous => session.TrySkipPreviousAsync()?.join(),
    }
}

/// La portada de la canción actual: se baja una vez por canción, no en cada revisión.
struct ArtworkCache {
    key: String,
    artwork: Option<String>,
    attempts: u32,
}

pub struct SystemMedia {
    artwork: Mutex<Option<ArtworkCache>>,
}

impl SystemMedia {
    pub fn new() -> Self {
        Self {
            artwork: Mutex::new(None),
        }
    }

    fn artwork_for(&self, key: String, properties: &Properties) -> Option<String> {
        let mut cache = self.artwork.lock().unwrap_or_else(PoisonError::into_inner);
        let same_song = cache.as_ref().is_some_and(|cached| cached.key == key);
        if !same_song {
            *cache = Some(ArtworkCache {
                key,
                artwork: None,
                attempts: 0,
            });
        }
        let cached = cache.as_mut()?;
        if cached.artwork.is_none() && cached.attempts < ARTWORK_ATTEMPTS {
            cached.attempts += 1;
            cached.artwork = read_artwork(properties).ok().flatten();
        }
        cached.artwork.clone()
    }

    fn read(&self) -> WinResult<Option<NowPlaying>> {
        let session = current_session()?;
        let properties = session.TryGetMediaPropertiesAsync()?.join()?;
        let title = properties.Title()?.to_string();
        if title.trim().is_empty() {
            return Ok(None);
        }
        let artist = properties.Artist()?.to_string();
        let playing = session.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing;
        let (duration, position, position_at_ms) = read_timeline(&session).unwrap_or_default();
        let artwork = self.artwork_for(format!("{title}\u{0}{artist}"), &properties);
        Ok(Some(NowPlaying {
            title,
            artist: (!artist.trim().is_empty()).then_some(artist),
            playing,
            artwork,
            duration,
            position,
            position_at_ms,
        }))
    }
}

impl Default for SystemMedia {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaPort for SystemMedia {
    fn now_playing(&self) -> Option<NowPlaying> {
        init_winrt();
        // Sin sesión de medios, `read` devuelve un error: es el caso normal de "no suena nada".
        self.read().ok().flatten()
    }

    fn send(&self, command: MediaCommand) -> Result<(), MediaError> {
        // Esperar a WinRT bloquea el hilo; en un hilo propio nunca estorba al de la interfaz.
        let accepted = thread::spawn(move || {
            init_winrt();
            run(command)
        })
        .join()
        .map_err(|_| MediaError::Command("el hilo de la orden falló".into()))?
        .map_err(|error| MediaError::Command(error.message()))?;

        if accepted {
            Ok(())
        } else {
            Err(MediaError::Command(
                "el reproductor no aceptó la orden".into(),
            ))
        }
    }
}
