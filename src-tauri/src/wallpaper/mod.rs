//! Fondo de pantalla animado, al estilo Wallpaper Engine: una imagen o un video a pantalla completa
//! detrás de los iconos del escritorio, en cada monitor. Los archivos los pone el usuario en una
//! carpeta que crea la app (`Imágenes/Orbit/Wallpapers`).
//!
//! Núcleo (§4.0): aquí viven la lista de archivos, los ajustes, las reglas de pausa y el servicio que
//! las aplica. Las ventanas del escritorio las crea el puerto `Surface` (`surface.rs`) y las ventanas
//! abiertas del usuario las mira el puerto `WindowWatcher` (`platform/`); los dos los elige el
//! composition root (`lib.rs`). Así se prueba sin tocar el escritorio de nadie.
//!
//! Los videos van sin sonido salvo que el usuario lo active, y solo suenan si traen una pista de
//! audio (`audio.rs` lo comprueba). Con más de un monitor, el fondo puede ser el mismo en todos o uno
//! distinto en cada uno. Si Orbit se cierra, las ventanas desaparecen y el escritorio vuelve a su
//! fondo de siempre: no se cambia nada del sistema.
//!
//! IMPORTANTE: el candado de `inner` nunca se sostiene mientras se llama a `surface` o a `watcher`:
//! esas llamadas pueden necesitar el hilo principal, y el hilo principal también lee el estado.

pub mod audio;
pub mod platform;
pub mod surface;

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, TryLockError};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::events::{DomainEvent, EventSink};
use crate::window::island_window::Rect;

/// Cada cuánto se mira si hay ventanas abiertas encima del fondo (y si cambiaron los monitores).
const TICK_EVERY: Duration = Duration::from_secs(1);
/// Tope de archivos que se listan (una carpeta enorme no debe congelar la página de Ajustes).
const MAX_ITEMS: usize = 1_000;
/// Una ventana cuenta como "abierta" si tapa al menos esta parte del monitor: así no cuentan los
/// iconos de la barra de menús ni las ventanas diminutas que algunas apps dejan invisibles.
const MIN_COVER: f64 = 0.03;
/// En el modo "grandes", se pausa cuando una sola ventana tapa al menos esta parte del monitor.
const LARGE_COVER: f64 = 0.5;
/// Volumen con el que empiezan los videos con sonido (de 0 a 100).
const DEFAULT_VOLUME: u8 = 60;
const MAX_VOLUME: u8 = 100;

const IMAGE_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];
const VIDEO_EXTENSIONS: [&str; 4] = ["mp4", "m4v", "mov", "webm"];

#[derive(Debug, thiserror::Error)]
pub enum WallpaperError {
    #[error("no se pudo mostrar el fondo: {0}")]
    Surface(String),
    #[error("no se pudo copiar el archivo: {0}")]
    Copy(String),
    #[error("ese fondo ya no está en la carpeta")]
    NotFound,
    #[error("no se pudo abrir la carpeta: {0}")]
    OpenFolder(String),
}

impl WallpaperError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Surface(_) => "wallpaper.surface",
            Self::Copy(_) => "wallpaper.copy",
            Self::NotFound => "wallpaper.notFound",
            Self::OpenFolder(_) => "wallpaper.openFolder",
        }
    }
}

/// Qué es un archivo de la carpeta.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Image,
    Video,
}

/// Cuándo se pausa el fondo solo para ahorrar recursos.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceMode {
    /// Nunca se pausa solo.
    Off,
    /// Se pausa cuando una ventana grande (o a pantalla completa) tapa el monitor.
    Large,
    /// Se pausa cuando hay cualquier ventana abierta sobre el monitor. Es el que menos gasta.
    #[default]
    Any,
}

/// Lo que el usuario eligió para un monitor concreto (cuando cada monitor tiene su fondo).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScreenChoice {
    /// Su archivo; `None` = usa el de todos.
    pub file: Option<String>,
    /// Si suena; `None` = lo que se eligió para todos.
    pub sound: Option<bool>,
}

/// Lo que el usuario eligió. Es lo que se guarda en los ajustes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WallpaperSettings {
    /// ¿Se muestra el fondo?
    pub enabled: bool,
    /// Nombre del archivo elegido para todos los monitores, dentro de la carpeta de fondos.
    pub file: Option<String>,
    /// ¿Suena el video? (Solo si trae audio.) Para todos los monitores.
    pub sound: bool,
    /// Volumen de los videos con sonido, de 0 a 100.
    pub volume: u8,
    /// Pausa a mano (el fondo se queda congelado hasta reanudarlo).
    pub paused: bool,
    pub performance: PerformanceMode,
    /// `false`: el mismo fondo en todos los monitores. `true`: cada monitor puede tener el suyo.
    pub per_screen: bool,
    /// Lo elegido para cada monitor (por su nombre), cuando `per_screen` está activo.
    pub screens: BTreeMap<String, ScreenChoice>,
}

impl Default for WallpaperSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            file: None,
            sound: false,
            volume: DEFAULT_VOLUME,
            paused: false,
            performance: PerformanceMode::default(),
            per_screen: false,
            screens: BTreeMap::new(),
        }
    }
}

impl WallpaperSettings {
    /// Lo que le toca a un monitor: su archivo y si suena. Con un fondo por monitor, lo que no se haya
    /// elegido para ese monitor sale de lo elegido para todos.
    pub fn choice_for(&self, key: &str) -> (Option<&str>, bool) {
        let own = if self.per_screen {
            self.screens.get(key)
        } else {
            None
        };
        let file = own
            .and_then(|choice| choice.file.as_deref())
            .or(self.file.as_deref());
        let sound = own.and_then(|choice| choice.sound).unwrap_or(self.sound);
        (file, sound)
    }
}

/// Un archivo de la carpeta de fondos. Espejo de `WallpaperItem` en `src/types/wallpaper.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperItem {
    pub file: String,
    pub kind: MediaKind,
    pub size: u64,
    /// Ruta completa, para que la interfaz lo cargue.
    pub path: String,
    /// Un video: ¿trae pista de sonido? `None` si es una imagen o no se pudo saber.
    pub has_audio: Option<bool>,
}

/// Un monitor conectado.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenInfo {
    /// Nombre único del monitor: con él se guarda lo elegido para ese monitor.
    pub key: String,
    /// El nombre que el sistema le da para mostrarlo (`None` si no lo dice).
    pub label: Option<String>,
}

/// Lo que ve cada ventana de fondo y la página de Ajustes de un monitor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenStatus {
    /// Nombre único del monitor (el del sistema; `#2` si no tiene).
    pub key: String,
    /// El nombre que el sistema le da para mostrarlo (`null` si no lo dice).
    pub label: Option<String>,
    /// Archivo que le toca (el suyo o el de todos).
    pub file: Option<String>,
    pub kind: Option<MediaKind>,
    /// Ruta completa del archivo, si sigue en la carpeta.
    pub path: Option<String>,
    /// Lo que se pidió para este monitor: ¿con sonido?
    pub sound: bool,
    /// ¿Trae audio el video? `None` si es una imagen o no se sabe.
    pub has_audio: Option<bool>,
    /// ¿Suena de verdad ahora? Es un video que se está moviendo, se pidió sonido, no se sabe que le
    /// falte el audio y el mismo archivo no suena ya en otro monitor.
    pub audible: bool,
    /// El archivo que le toca ya no está en la carpeta.
    pub missing: bool,
    /// ¿Está en pausa por el modo rendimiento?
    pub paused: bool,
}

/// Espejo de `WallpaperStatus` en `src/types/wallpaper.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperStatus {
    pub enabled: bool,
    /// Archivo elegido para todos los monitores.
    pub file: Option<String>,
    /// ¿Suena? Para todos los monitores.
    pub sound: bool,
    pub volume: u8,
    /// Pausa a mano.
    pub manual_pause: bool,
    pub performance: PerformanceMode,
    /// ¿Cada monitor tiene su fondo?
    pub per_screen: bool,
    /// Los monitores conectados, en el orden de sus ventanas.
    pub screens: Vec<ScreenStatus>,
    /// La carpeta donde se ponen los fondos.
    pub folder: String,
    /// Código del último fallo al mostrar el fondo (`wallpaper.*`); `None` si no hubo.
    pub error: Option<String>,
}

/// Cuánto de un monitor tapan las ventanas abiertas.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct ScreenCover {
    /// Cuántas ventanas cuentan como abiertas sobre el monitor.
    pub windows: usize,
    /// La parte del monitor (de 0 a 1) que tapa la ventana más grande.
    pub largest: f64,
}

/// Puerto: las ventanas del escritorio donde se dibuja el fondo (una por monitor que tenga fondo).
pub trait Surface: Send + Sync {
    /// Los monitores conectados, cada uno con un nombre único, en el orden de sus ventanas.
    fn screens(&self) -> Result<Vec<ScreenInfo>, WallpaperError>;
    /// Deja una ventana, bien colocada, en cada monitor marcado en `active` (mismo orden que
    /// `screens`) y quita las de los demás. Se puede llamar todo el tiempo: si nada cambió, no hace
    /// nada.
    fn sync(&self, active: &[bool]) -> Result<(), WallpaperError>;
    /// Cierra todas las ventanas de fondo.
    fn hide(&self);
}

/// Puerto: mira qué ventanas de otras apps hay abiertas sobre cada monitor.
pub trait WindowWatcher: Send + Sync {
    /// Una entrada por monitor, en el mismo orden que `Surface::screens`.
    fn covers(&self) -> Result<Vec<ScreenCover>, WallpaperError>;
}

/// Un nombre único para cada monitor a partir de los que da el sistema: dos monitores con el mismo
/// nombre se distinguen con ` (2)`, y uno sin nombre se llama `#<número>`.
pub fn screen_keys(names: &[Option<String>]) -> Vec<String> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    names
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let base = name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map_or_else(|| format!("#{}", index + 1), str::to_owned);
            let count = seen.entry(base.clone()).or_insert(0);
            *count += 1;
            if *count == 1 {
                base
            } else {
                format!("{base} ({count})")
            }
        })
        .collect()
}

/// El tipo de archivo por su extensión (sin importar mayúsculas); `None` si no sirve de fondo.
pub fn kind_of(path: &Path) -> Option<MediaKind> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        Some(MediaKind::Image)
    } else if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        Some(MediaKind::Video)
    } else {
        None
    }
}

/// Las extensiones que se aceptan (para el selector de archivos).
pub fn accepted_extensions() -> Vec<&'static str> {
    IMAGE_EXTENSIONS
        .iter()
        .chain(VIDEO_EXTENSIONS.iter())
        .copied()
        .collect()
}

/// Los archivos de la carpeta que sirven de fondo, ordenados por nombre. No entra en subcarpetas ni
/// lista archivos ocultos. `has_audio` queda en `None`: lo completa el servicio.
pub fn list_items(dir: &Path) -> Vec<WallpaperItem> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut items: Vec<WallpaperItem> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let file = path.file_name()?.to_str()?.to_owned();
            if file.starts_with('.') {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some(WallpaperItem {
                kind: kind_of(&path)?,
                size: metadata.len(),
                path: path.display().to_string(),
                has_audio: None,
                file,
            })
        })
        .collect();
    items.sort_by_key(|item| item.file.to_lowercase());
    items.truncate(MAX_ITEMS);
    items
}

/// El archivo elegido, si sigue en la carpeta. Un nombre con rutas (`../x.png`) nunca vale: solo se
/// sirven archivos de esa carpeta. `has_audio` queda en `None`: lo completa el servicio.
pub fn find_item(dir: &Path, file: &str) -> Option<WallpaperItem> {
    let is_plain_name = Path::new(file).file_name().and_then(|name| name.to_str()) == Some(file);
    if !is_plain_name || file.starts_with('.') {
        return None;
    }
    let path = dir.join(file);
    let metadata = fs::metadata(&path).ok().filter(fs::Metadata::is_file)?;
    Some(WallpaperItem {
        kind: kind_of(&path)?,
        size: metadata.len(),
        path: path.display().to_string(),
        has_audio: None,
        file: file.to_owned(),
    })
}

/// Copia un archivo a la carpeta de fondos sin pisar ninguno: si ya hay uno con ese nombre,
/// añade ` (2)`, ` (3)`… Devuelve el nombre con el que quedó.
pub fn copy_into(dir: &Path, source: &Path) -> Result<String, WallpaperError> {
    kind_of(source).ok_or_else(|| WallpaperError::Copy("tipo de archivo no admitido".into()))?;
    let stem = source
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| WallpaperError::Copy("nombre de archivo no válido".into()))?;
    let extension = source
        .extension()
        .and_then(|name| name.to_str())
        .unwrap_or_default();

    fs::create_dir_all(dir).map_err(|error| WallpaperError::Copy(error.to_string()))?;
    for attempt in 1..=1_000 {
        let name = if attempt == 1 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem} ({attempt}).{extension}")
        };
        let target = dir.join(&name);
        if target.exists() {
            continue;
        }
        // Se copia a un archivo temporal y se renombra: nunca queda a medias a la vista.
        let partial = dir.join(format!(".{name}.part"));
        let copied = fs::copy(source, &partial).and_then(|_| fs::rename(&partial, &target));
        if let Err(error) = copied {
            let _ = fs::remove_file(&partial);
            return Err(WallpaperError::Copy(error.to_string()));
        }
        return Ok(name);
    }
    Err(WallpaperError::Copy(
        "demasiados archivos con ese nombre".into(),
    ))
}

fn intersection_area(a: Rect, b: Rect) -> f64 {
    let width = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
    let height = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
    if width <= 0.0 || height <= 0.0 {
        0.0
    } else {
        width * height
    }
}

/// Cuánto tapan `windows` del monitor `screen` (todo en las mismas unidades). Una ventana cuenta si
/// tapa al menos `MIN_COVER` del monitor.
pub fn cover_of(screen: Rect, windows: &[Rect]) -> ScreenCover {
    let area = screen.width * screen.height;
    if area <= 0.0 {
        return ScreenCover::default();
    }
    let mut cover = ScreenCover::default();
    for window in windows {
        let fraction = intersection_area(screen, *window) / area;
        if fraction >= MIN_COVER {
            cover.windows += 1;
            cover.largest = cover.largest.max(fraction);
        }
    }
    cover
}

/// ¿El modo rendimiento pide pausar el fondo de ese monitor?
pub fn paused_by_performance(mode: PerformanceMode, cover: ScreenCover) -> bool {
    match mode {
        PerformanceMode::Off => false,
        PerformanceMode::Large => cover.largest >= LARGE_COVER,
        PerformanceMode::Any => cover.windows > 0,
    }
}

/// Lo que el servicio sabe en cada momento. Se copia entera para leerla sin el candado.
#[derive(Clone)]
struct Inner {
    settings: WallpaperSettings,
    /// Los monitores conocidos, en el orden de sus ventanas.
    screens: Vec<ScreenInfo>,
    /// Por monitor: ¿en pausa por el modo rendimiento?
    screen_paused: Vec<bool>,
    /// ¿Hay alguna ventana de fondo en el escritorio?
    shown: bool,
    error: Option<&'static str>,
}

pub struct WallpaperService {
    dir: PathBuf,
    surface: Box<dyn Surface>,
    watcher: Box<dyn WindowWatcher>,
    events: Arc<dyn EventSink>,
    inner: Mutex<Inner>,
    /// Hace que las llamadas a `surface` y a `watcher` vayan de una en una. Esas llamadas pueden
    /// necesitar el hilo principal (crear ventanas, leer los monitores), y el hilo principal también
    /// lee el estado (`status`): por eso el candado de `inner` NUNCA se sostiene mientras corren, o
    /// los dos hilos se esperarían el uno al otro y la app se congelaría.
    gate: Mutex<()>,
    /// Si cada video trae audio, por nombre de archivo y tamaño (así no se vuelve a leer el archivo).
    audio: Mutex<HashMap<String, (u64, Option<bool>)>>,
}

impl WallpaperService {
    /// Crea la carpeta de fondos si no existe. `settings` es lo que estaba guardado: `restore` lo
    /// aplica.
    pub fn new(
        dir: PathBuf,
        surface: Box<dyn Surface>,
        watcher: Box<dyn WindowWatcher>,
        events: Arc<dyn EventSink>,
        mut settings: WallpaperSettings,
    ) -> Self {
        if let Err(error) = fs::create_dir_all(&dir) {
            tracing::warn!(%error, "no se pudo crear la carpeta de fondos");
        }
        settings.volume = settings.volume.min(MAX_VOLUME);
        Self {
            dir,
            surface,
            watcher,
            events,
            inner: Mutex::new(Inner {
                settings,
                screens: Vec::new(),
                screen_paused: Vec::new(),
                shown: false,
                error: None,
            }),
            gate: Mutex::new(()),
            audio: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn folder(&self) -> &Path {
        &self.dir
    }

    /// ¿Trae audio ese video? Se lee una vez por archivo (y otra si cambia de tamaño).
    fn audio_of(&self, item: &WallpaperItem) -> Option<bool> {
        if item.kind != MediaKind::Video {
            return None;
        }
        let cached = self
            .audio
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&item.file)
            .copied();
        if let Some((size, known)) = cached {
            if size == item.size {
                return known;
            }
        }
        let known = audio::has_audio(Path::new(&item.path));
        self.audio
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(item.file.clone(), (item.size, known));
        known
    }

    /// El archivo de la carpeta con todo lo que se sabe de él, si sigue ahí.
    fn describe(&self, file: &str) -> Option<WallpaperItem> {
        let mut item = find_item(&self.dir, file)?;
        item.has_audio = self.audio_of(&item);
        Some(item)
    }

    /// Los archivos que hay ahora en la carpeta.
    pub fn items(&self) -> Vec<WallpaperItem> {
        let mut items = list_items(&self.dir);
        for item in &mut items {
            item.has_audio = self.audio_of(item);
        }
        items
    }

    /// Lo que está elegido, para guardarlo en los ajustes.
    pub fn settings(&self) -> WallpaperSettings {
        self.lock().settings.clone()
    }

    fn view(&self, inner: &Inner) -> WallpaperStatus {
        let mut screens = Vec::with_capacity(inner.screens.len());
        // Archivos que ya suenan en otro monitor: el mismo video no debe sonar dos veces a la vez.
        let mut sounding: Vec<String> = Vec::new();
        for (index, screen) in inner.screens.iter().enumerate() {
            let (file, sound) = inner.settings.choice_for(&screen.key);
            let item = file.and_then(|file| self.describe(file));
            let kind = item.as_ref().map(|item| item.kind);
            let has_audio = item.as_ref().and_then(|item| item.has_audio);
            let paused = inner.screen_paused.get(index).copied().unwrap_or(false);
            let mut audible =
                sound && !paused && kind == Some(MediaKind::Video) && has_audio != Some(false);
            if let Some(file) = file.filter(|_| audible) {
                if sounding.iter().any(|playing| playing == file) {
                    audible = false;
                } else {
                    sounding.push(file.to_owned());
                }
            }
            screens.push(ScreenStatus {
                key: screen.key.clone(),
                label: screen.label.clone(),
                file: file.map(str::to_owned),
                kind,
                path: item.as_ref().map(|item| item.path.clone()),
                sound,
                has_audio,
                audible,
                missing: file.is_some() && item.is_none(),
                paused,
            });
        }
        WallpaperStatus {
            enabled: inner.settings.enabled,
            file: inner.settings.file.clone(),
            sound: inner.settings.sound,
            volume: inner.settings.volume,
            manual_pause: inner.settings.paused,
            performance: inner.settings.performance,
            per_screen: inner.settings.per_screen,
            screens,
            folder: self.dir.display().to_string(),
            error: inner.error.map(str::to_owned),
        }
    }

    /// Cómo está el fondo ahora. No toca las ventanas del escritorio ni espera al hilo principal.
    pub fn status(&self) -> WallpaperStatus {
        let inner = self.lock().clone();
        self.view(&inner)
    }

    /// Guarda los monitores que se conocen (y deja una entrada de pausa por cada uno).
    fn remember_screens(inner: &mut Inner, screens: Vec<ScreenInfo>) {
        inner.screen_paused.resize(screens.len(), false);
        inner.screens = screens;
    }

    /// Mira los monitores y deja una ventana de fondo en cada uno que tenga un fondo que mostrar (y
    /// ninguna en los demás). Hay que llamarla con `gate` tomado y SIN el candado de `inner`.
    fn apply(&self) {
        let settings = self.lock().settings.clone();
        let screens = match self.surface.screens() {
            Ok(screens) => screens,
            Err(error) => {
                // Sin saber qué monitores hay no se toca nada: las ventanas que ya estén se quedan.
                tracing::warn!(%error, "no se pudieron leer los monitores");
                self.lock().error = Some(error.code());
                return;
            }
        };
        let active: Vec<bool> = screens
            .iter()
            .map(|screen| {
                settings.enabled
                    && settings
                        .choice_for(&screen.key)
                        .0
                        .and_then(|file| find_item(&self.dir, file))
                        .is_some()
            })
            .collect();
        let any = active.contains(&true);

        let mut failure = None;
        if any {
            if let Err(error) = self.surface.sync(&active) {
                tracing::warn!(%error, "no se pudo mostrar el fondo de pantalla");
                failure = Some(error.code());
            }
        } else if self.lock().shown {
            self.surface.hide();
        }

        let mut inner = self.lock();
        inner.shown = any && failure.is_none();
        inner.error = failure;
        Self::remember_screens(&mut inner, screens);
        if !inner.shown {
            inner.screen_paused.fill(false);
        }
    }

    /// Solo actualiza la lista de monitores (cuando no hay ventanas que acomodar).
    fn refresh_screens(&self) {
        if let Ok(screens) = self.surface.screens() {
            Self::remember_screens(&mut self.lock(), screens);
        }
    }

    fn reconcile(&self) {
        let _gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
        self.apply();
    }

    /// Cambia los ajustes y los aplica ya. Guardarlos en disco lo hace quien llama.
    pub fn update(&self, change: impl FnOnce(&mut WallpaperSettings)) -> WallpaperStatus {
        change(&mut self.lock().settings);
        self.reconcile();
        let status = self.status();
        self.events.publish(DomainEvent::Wallpaper(status.clone()));
        status
    }

    /// Cambia ajustes que no tocan las ventanas del escritorio (el sonido y el volumen): solo se
    /// avisa a la interfaz, sin esperar al hilo principal. Así mover el volumen es instantáneo.
    fn adjust(&self, change: impl FnOnce(&mut WallpaperSettings)) -> WallpaperStatus {
        change(&mut self.lock().settings);
        let status = self.status();
        self.events.publish(DomainEvent::Wallpaper(status.clone()));
        status
    }

    /// Elige un archivo de la carpeta y lo activa: para un monitor (si cada monitor tiene su fondo y
    /// se indica cuál) o para todos. Falla si el archivo ya no está.
    pub fn select(
        &self,
        file: &str,
        screen: Option<&str>,
    ) -> Result<WallpaperStatus, WallpaperError> {
        if find_item(&self.dir, file).is_none() {
            return Err(WallpaperError::NotFound);
        }
        Ok(self.update(|settings| {
            match screen {
                Some(key) if settings.per_screen => {
                    settings.screens.entry(key.to_owned()).or_default().file =
                        Some(file.to_owned());
                }
                _ => settings.file = Some(file.to_owned()),
            }
            settings.enabled = true;
        }))
    }

    /// Activa o quita el sonido, para un monitor (si cada monitor tiene su fondo y se indica cuál) o
    /// para todos.
    pub fn set_sound(&self, sound: bool, screen: Option<&str>) -> WallpaperStatus {
        self.adjust(|settings| match screen {
            Some(key) if settings.per_screen => {
                settings.screens.entry(key.to_owned()).or_default().sound = Some(sound);
            }
            _ => settings.sound = sound,
        })
    }

    /// El volumen de los videos con sonido (se corta en 100).
    pub fn set_volume(&self, volume: u8) -> WallpaperStatus {
        self.adjust(|settings| settings.volume = volume.min(MAX_VOLUME))
    }

    /// Aplica lo guardado al arrancar la app.
    pub fn restore(&self) {
        self.update(|_| {});
    }

    /// Revisa los monitores y las ventanas abiertas y pausa o reanuda cada fondo. Avisa a la interfaz
    /// solo si algo cambió. Si en ese momento se están cambiando las ventanas, se salta esta vuelta.
    pub fn tick(&self) {
        let _gate = match self.gate.try_lock() {
            Ok(gate) => gate,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return,
        };
        let before = self.status();
        let shown = self.lock().shown;
        if !shown {
            // Sin ventanas solo se mantiene al día la lista de monitores (la página de Ajustes la usa).
            self.refresh_screens();
        } else {
            // Si se conectó o quitó un monitor, las ventanas se acomodan.
            self.apply();
            self.pause_by_performance();
        }

        let after = self.status();
        if before != after {
            self.events.publish(DomainEvent::Wallpaper(after));
        }
    }

    /// Mira las ventanas abiertas y pausa o reanuda el fondo de cada monitor. Hay que llamarla con
    /// `gate` tomado y SIN el candado de `inner`.
    fn pause_by_performance(&self) {
        let (mode, manual, screens, shown) = {
            let inner = self.lock();
            (
                inner.settings.performance,
                inner.settings.paused,
                inner.screens.len(),
                inner.shown,
            )
        };
        // En pausa a mano o con el modo apagado no hace falta mirar las ventanas.
        let paused = if !shown || manual || mode == PerformanceMode::Off {
            vec![false; screens]
        } else {
            match self.watcher.covers() {
                Ok(covers) => (0..screens)
                    .map(|index| {
                        covers
                            .get(index)
                            .is_some_and(|cover| paused_by_performance(mode, *cover))
                    })
                    .collect(),
                Err(error) => {
                    tracing::debug!(%error, "no se pudieron leer las ventanas abiertas");
                    vec![false; screens]
                }
            }
        };
        self.lock().screen_paused = paused;
    }
}

/// Hilo que vigila las ventanas abiertas mientras la app esté abierta.
pub fn spawn_ticker(service: Arc<WallpaperService>) {
    let spawned = thread::Builder::new()
        .name("orbit-wallpaper".into())
        .spawn(move || loop {
            service.tick();
            thread::sleep(TICK_EVERY);
        });
    if let Err(error) = spawned {
        tracing::warn!(%error, "no se pudo iniciar la vigilancia del fondo de pantalla");
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;
    use crate::events::testing::FakeEventSink;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("orbit-wallpaper-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn put(dir: &Path, name: &str, content: &[u8]) {
        fs::write(dir.join(name), content).unwrap();
    }

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    // ── archivos ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn images_and_videos_are_recognised_by_extension() {
        assert_eq!(kind_of(Path::new("a.PNG")), Some(MediaKind::Image));
        assert_eq!(kind_of(Path::new("a.jpeg")), Some(MediaKind::Image));
        assert_eq!(kind_of(Path::new("a.webp")), Some(MediaKind::Image));
        assert_eq!(kind_of(Path::new("a.MP4")), Some(MediaKind::Video));
        assert_eq!(kind_of(Path::new("a.mov")), Some(MediaKind::Video));
        assert_eq!(kind_of(Path::new("a.webm")), Some(MediaKind::Video));
        assert_eq!(kind_of(Path::new("a.gif")), None);
        assert_eq!(kind_of(Path::new("a.txt")), None);
        assert_eq!(kind_of(Path::new("sin_extension")), None);
        assert!(accepted_extensions().contains(&"mp4"));
        assert!(!accepted_extensions().contains(&"txt"));
    }

    #[test]
    fn the_folder_lists_only_usable_files_sorted_by_name() {
        let dir = temp_dir("list");
        put(&dir, "b.mp4", b"video");
        put(&dir, "A.png", b"imagen");
        put(&dir, "c.txt", b"no");
        put(&dir, ".oculto.png", b"no");
        fs::create_dir_all(dir.join("subcarpeta.png")).unwrap();

        let items = list_items(&dir);

        assert_eq!(
            items.iter().map(|i| i.file.as_str()).collect::<Vec<_>>(),
            vec!["A.png", "b.mp4"]
        );
        assert_eq!(items[0].kind, MediaKind::Image);
        assert_eq!(items[1].kind, MediaKind::Video);
        assert_eq!(items[1].size, 5);
        assert_eq!(items[0].path, dir.join("A.png").display().to_string());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_missing_folder_lists_nothing() {
        assert!(list_items(&std::env::temp_dir().join("orbit-no-such-wallpapers")).is_empty());
    }

    #[test]
    fn only_plain_file_names_inside_the_folder_are_found() {
        let dir = temp_dir("find");
        put(&dir, "ok.png", b"x");
        put(&dir, ".hidden.png", b"x");
        let outside = dir.parent().unwrap().join("fuera.png");
        fs::write(&outside, b"x").unwrap();

        assert!(find_item(&dir, "ok.png").is_some());
        assert!(find_item(&dir, "no-esta.png").is_none());
        assert!(find_item(&dir, ".hidden.png").is_none());
        assert!(find_item(&dir, "../fuera.png").is_none());
        assert!(find_item(&dir, "sub/ok.png").is_none());
        assert!(find_item(&dir, "").is_none());
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn copying_never_overwrites_a_file_with_the_same_name() {
        let dir = temp_dir("copy");
        let source_dir = temp_dir("copy-source");
        put(&source_dir, "fondo.png", b"nuevo");
        put(&dir, "fondo.png", b"viejo");

        let first = copy_into(&dir, &source_dir.join("fondo.png")).unwrap();
        let second = copy_into(&dir, &source_dir.join("fondo.png")).unwrap();

        assert_eq!(first, "fondo (2).png");
        assert_eq!(second, "fondo (3).png");
        assert_eq!(fs::read(dir.join("fondo.png")).unwrap(), b"viejo");
        assert_eq!(fs::read(dir.join("fondo (2).png")).unwrap(), b"nuevo");
        assert!(!dir.join(".fondo (2).png.part").exists());
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(source_dir);
    }

    #[test]
    fn copying_refuses_files_that_are_not_wallpapers_and_missing_ones() {
        let dir = temp_dir("copy-bad");
        let source_dir = temp_dir("copy-bad-source");
        put(&source_dir, "notas.txt", b"x");

        assert_eq!(
            copy_into(&dir, &source_dir.join("notas.txt"))
                .unwrap_err()
                .code(),
            "wallpaper.copy"
        );
        assert!(copy_into(&dir, &source_dir.join("no-existe.png")).is_err());
        assert!(list_items(&dir).is_empty());
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(source_dir);
    }

    // ── cobertura y modo rendimiento ─────────────────────────────────────────────────────────

    #[test]
    fn the_cover_counts_windows_that_are_big_enough_over_the_screen() {
        let screen = rect(0.0, 0.0, 1000.0, 1000.0);

        let none = cover_of(screen, &[]);
        assert_eq!((none.windows, none.largest), (0, 0.0));

        // 100×100 es el 1 %: no cuenta (un icono de la barra, una ventana diminuta).
        assert_eq!(
            cover_of(screen, &[rect(10.0, 10.0, 100.0, 100.0)]).windows,
            0
        );

        let cover = cover_of(
            screen,
            &[
                rect(0.0, 0.0, 500.0, 500.0),
                rect(600.0, 600.0, 300.0, 300.0),
            ],
        );
        assert_eq!(cover.windows, 2);
        assert!((cover.largest - 0.25).abs() < 1e-9);
    }

    #[test]
    fn a_window_on_another_monitor_does_not_count() {
        let left = rect(0.0, 0.0, 1000.0, 1000.0);
        let right = rect(1000.0, 0.0, 1000.0, 1000.0);
        let window = [rect(1100.0, 100.0, 600.0, 600.0)];

        assert_eq!(cover_of(left, &window).windows, 0);
        assert_eq!(cover_of(right, &window).windows, 1);
    }

    #[test]
    fn a_window_half_outside_the_screen_only_counts_the_part_inside() {
        let screen = rect(0.0, 0.0, 1000.0, 1000.0);
        let cover = cover_of(screen, &[rect(800.0, 0.0, 400.0, 1000.0)]);
        assert!((cover.largest - 0.2).abs() < 1e-9);
    }

    #[test]
    fn an_empty_screen_covers_nothing() {
        assert_eq!(
            cover_of(rect(0.0, 0.0, 0.0, 0.0), &[rect(0.0, 0.0, 10.0, 10.0)]).windows,
            0
        );
    }

    #[test]
    fn each_performance_mode_pauses_in_its_own_cases() {
        let none = ScreenCover::default();
        let small = ScreenCover {
            windows: 1,
            largest: 0.2,
        };
        let big = ScreenCover {
            windows: 1,
            largest: 0.9,
        };

        for cover in [none, small, big] {
            assert!(!paused_by_performance(PerformanceMode::Off, cover));
        }
        assert!(!paused_by_performance(PerformanceMode::Large, none));
        assert!(!paused_by_performance(PerformanceMode::Large, small));
        assert!(paused_by_performance(PerformanceMode::Large, big));
        assert!(!paused_by_performance(PerformanceMode::Any, none));
        assert!(paused_by_performance(PerformanceMode::Any, small));
        assert!(paused_by_performance(PerformanceMode::Any, big));
    }

    // ── ajustes por monitor ──────────────────────────────────────────────────────────────────

    #[test]
    fn every_monitor_follows_the_shared_choice_unless_each_has_its_own() {
        let mut settings = WallpaperSettings {
            file: Some("mar.mp4".into()),
            sound: true,
            ..WallpaperSettings::default()
        };
        settings.screens.insert(
            "B".into(),
            ScreenChoice {
                file: Some("montana.png".into()),
                sound: Some(false),
            },
        );

        // Con el mismo fondo en todos, lo de cada monitor no cuenta.
        assert_eq!(settings.choice_for("A"), (Some("mar.mp4"), true));
        assert_eq!(settings.choice_for("B"), (Some("mar.mp4"), true));

        settings.per_screen = true;
        assert_eq!(settings.choice_for("A"), (Some("mar.mp4"), true));
        assert_eq!(settings.choice_for("B"), (Some("montana.png"), false));
        assert_eq!(settings.choice_for("desconocido"), (Some("mar.mp4"), true));
    }

    #[test]
    fn a_monitor_can_have_its_own_sound_but_the_shared_file() {
        let mut settings = WallpaperSettings {
            file: Some("mar.mp4".into()),
            per_screen: true,
            ..WallpaperSettings::default()
        };
        settings.screens.insert(
            "B".into(),
            ScreenChoice {
                file: None,
                sound: Some(true),
            },
        );

        assert_eq!(settings.choice_for("A"), (Some("mar.mp4"), false));
        assert_eq!(settings.choice_for("B"), (Some("mar.mp4"), true));
    }

    #[test]
    fn monitors_get_unique_names() {
        let names = |list: &[Option<&str>]| -> Vec<String> {
            screen_keys(
                &list
                    .iter()
                    .map(|name| name.map(str::to_owned))
                    .collect::<Vec<_>>(),
            )
        };

        assert_eq!(
            names(&[Some("Built-in"), Some("DELL U2720Q")]),
            vec!["Built-in", "DELL U2720Q"]
        );
        // Dos iguales se distinguen; sin nombre (o vacío) se numera por posición.
        assert_eq!(
            names(&[Some("DELL"), Some("DELL"), Some("DELL")]),
            vec!["DELL", "DELL (2)", "DELL (3)"]
        );
        assert_eq!(
            names(&[None, Some("  "), Some(" LG ")]),
            vec!["#1", "#2", "LG"]
        );
        assert!(names(&[]).is_empty());
    }

    // ── servicio ─────────────────────────────────────────────────────────────────────────────

    struct FakeSurface {
        names: Mutex<Vec<String>>,
        /// Lo último que se pidió en `sync`.
        active: Mutex<Vec<bool>>,
        syncs: AtomicUsize,
        hides: AtomicUsize,
        fail: AtomicBool,
    }

    impl FakeSurface {
        fn new(names: &[&str]) -> Arc<Self> {
            Arc::new(Self {
                names: Mutex::new(names.iter().map(|name| (*name).to_owned()).collect()),
                active: Mutex::new(Vec::new()),
                syncs: AtomicUsize::new(0),
                hides: AtomicUsize::new(0),
                fail: AtomicBool::new(false),
            })
        }

        fn connect(&self, names: &[&str]) {
            *self.names.lock().unwrap() = names.iter().map(|name| (*name).to_owned()).collect();
        }

        fn last_active(&self) -> Vec<bool> {
            self.active.lock().unwrap().clone()
        }
    }

    impl Surface for Arc<FakeSurface> {
        fn screens(&self) -> Result<Vec<ScreenInfo>, WallpaperError> {
            Ok(self
                .names
                .lock()
                .unwrap()
                .iter()
                .map(|name| ScreenInfo {
                    key: name.clone(),
                    label: Some(format!("Pantalla {name}")),
                })
                .collect())
        }
        fn sync(&self, active: &[bool]) -> Result<(), WallpaperError> {
            self.syncs.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err(WallpaperError::Surface("sin ventana".into()));
            }
            *self.active.lock().unwrap() = active.to_vec();
            Ok(())
        }
        fn hide(&self) {
            self.hides.fetch_add(1, Ordering::SeqCst);
        }
    }

    struct FakeWatcher(Arc<Mutex<Vec<ScreenCover>>>);

    impl WindowWatcher for FakeWatcher {
        fn covers(&self) -> Result<Vec<ScreenCover>, WallpaperError> {
            Ok(self.0.lock().unwrap().clone())
        }
    }

    struct Fixture {
        service: WallpaperService,
        dir: PathBuf,
        surface: Arc<FakeSurface>,
        covers: Arc<Mutex<Vec<ScreenCover>>>,
        events: Arc<FakeEventSink>,
    }

    fn fixture(name: &str, settings: WallpaperSettings) -> Fixture {
        let dir = temp_dir(name);
        put(&dir, "mar.mp4", b"video");
        put(&dir, "montana.png", b"imagen");
        put(&dir, "con-audio.mp4", &audio::sample_mp4(true));
        put(&dir, "sin-audio.mp4", &audio::sample_mp4(false));
        let surface = FakeSurface::new(&["A", "B"]);
        let covers = Arc::new(Mutex::new(vec![ScreenCover::default(); 2]));
        let events = Arc::new(FakeEventSink::default());
        let service = WallpaperService::new(
            dir.clone(),
            Box::new(Arc::clone(&surface)),
            Box::new(FakeWatcher(Arc::clone(&covers))),
            Arc::clone(&events) as Arc<dyn EventSink>,
            settings,
        );
        Fixture {
            service,
            dir,
            surface,
            covers,
            events,
        }
    }

    fn on(file: &str) -> WallpaperSettings {
        WallpaperSettings {
            enabled: true,
            file: Some(file.into()),
            ..WallpaperSettings::default()
        }
    }

    fn cover(windows: usize, largest: f64) -> ScreenCover {
        ScreenCover { windows, largest }
    }

    fn paused(status: &WallpaperStatus) -> Vec<bool> {
        status.screens.iter().map(|screen| screen.paused).collect()
    }

    fn wallpaper_events(fx: &Fixture) -> Vec<WallpaperStatus> {
        fx.events
            .events()
            .into_iter()
            .filter_map(|event| match event {
                DomainEvent::Wallpaper(status) => Some(status),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn the_app_creates_the_folder_for_the_user_files() {
        let dir = temp_dir("create").join("Orbit").join("Wallpapers");
        assert!(!dir.exists());

        let _service = WallpaperService::new(
            dir.clone(),
            Box::new(FakeSurface::new(&["A"])),
            Box::new(FakeWatcher(Arc::default())),
            Arc::new(FakeEventSink::default()),
            WallpaperSettings::default(),
        );

        assert!(dir.is_dir());
        let _ = fs::remove_dir_all(dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn nothing_is_shown_until_a_wallpaper_is_chosen_and_enabled() {
        let fx = fixture("idle", WallpaperSettings::default());
        fx.service.restore();

        assert_eq!(fx.surface.syncs.load(Ordering::SeqCst), 0);
        let status = fx.service.status();
        assert!(!status.enabled);
        assert_eq!(status.file, None);
        assert_eq!(status.folder, fx.dir.display().to_string());
        // Los monitores se conocen desde el principio: la página de Ajustes los necesita.
        assert_eq!(
            status
                .screens
                .iter()
                .map(|s| s.key.as_str())
                .collect::<Vec<_>>(),
            vec!["A", "B"]
        );
        assert!(status
            .screens
            .iter()
            .all(|s| s.path.is_none() && !s.missing && !s.audible));
    }

    #[test]
    fn choosing_a_file_turns_it_on_and_puts_a_window_on_every_screen() {
        let fx = fixture("select", WallpaperSettings::default());

        let status = fx.service.select("mar.mp4", None).unwrap();

        assert!(status.enabled);
        assert_eq!(status.file.as_deref(), Some("mar.mp4"));
        for screen in &status.screens {
            assert_eq!(screen.file.as_deref(), Some("mar.mp4"));
            assert_eq!(screen.kind, Some(MediaKind::Video));
            assert_eq!(
                screen.path,
                Some(fx.dir.join("mar.mp4").display().to_string())
            );
        }
        assert_eq!(paused(&status), vec![false, false]);
        assert_eq!(fx.surface.syncs.load(Ordering::SeqCst), 1);
        assert_eq!(fx.surface.last_active(), vec![true, true]);
        assert_eq!(wallpaper_events(&fx).last(), Some(&status));
        assert_eq!(fx.service.settings(), on("mar.mp4"));
    }

    #[test]
    fn choosing_a_file_that_is_gone_is_an_error_and_changes_nothing() {
        let fx = fixture("gone", on("mar.mp4"));
        fx.service.restore();

        let error = fx.service.select("borrado.mp4", None).unwrap_err();

        assert_eq!(error.code(), "wallpaper.notFound");
        assert_eq!(fx.service.settings(), on("mar.mp4"));
        assert!(fx.service.select("../x.png", None).is_err());
    }

    #[test]
    fn what_was_saved_is_restored_on_start() {
        let fx = fixture("restore", on("montana.png"));
        fx.service.restore();
        assert_eq!(fx.surface.syncs.load(Ordering::SeqCst), 1);
        assert_eq!(fx.service.status().screens[0].kind, Some(MediaKind::Image));
    }

    #[test]
    fn turning_it_off_takes_the_windows_away_and_turning_it_on_brings_them_back() {
        let fx = fixture("toggle", on("mar.mp4"));
        fx.service.restore();

        let off = fx.service.update(|s| s.enabled = false);
        assert!(!off.enabled);
        assert_eq!(fx.surface.hides.load(Ordering::SeqCst), 1);
        assert_eq!(paused(&off), vec![false, false]);
        // El archivo elegido se recuerda para volver a activarlo.
        assert_eq!(off.file.as_deref(), Some("mar.mp4"));

        fx.service.update(|s| s.enabled = true);
        assert_eq!(fx.surface.syncs.load(Ordering::SeqCst), 2);
        // Apagarlo dos veces no cierra dos veces.
        fx.service.update(|s| s.enabled = false);
        fx.service.update(|s| s.enabled = false);
        assert_eq!(fx.surface.hides.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_wallpaper_whose_file_was_deleted_is_reported_and_not_shown() {
        let fx = fixture("missing", on("mar.mp4"));
        fs::remove_file(fx.dir.join("mar.mp4")).unwrap();

        fx.service.restore();

        let status = fx.service.status();
        assert!(status.screens.iter().all(|s| s.missing && s.path.is_none()));
        assert_eq!(fx.surface.syncs.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_failure_to_show_the_windows_is_reported_and_can_recover() {
        let fx = fixture("fail", on("mar.mp4"));
        fx.surface.fail.store(true, Ordering::SeqCst);
        fx.service.restore();
        assert_eq!(
            fx.service.status().error.as_deref(),
            Some("wallpaper.surface")
        );

        fx.surface.fail.store(false, Ordering::SeqCst);
        fx.service.update(|_| {});
        assert_eq!(fx.service.status().error, None);
    }

    #[test]
    fn performance_mode_pauses_each_screen_by_itself_and_resumes() {
        let fx = fixture("perf", on("mar.mp4"));
        fx.service.restore();

        // Una ventana abierta en el segundo monitor.
        *fx.covers.lock().unwrap() = vec![cover(0, 0.0), cover(1, 0.3)];
        fx.service.tick();
        assert_eq!(paused(&fx.service.status()), vec![false, true]);

        // Se cierra: el fondo vuelve a moverse.
        *fx.covers.lock().unwrap() = vec![cover(0, 0.0), cover(0, 0.0)];
        fx.service.tick();
        assert_eq!(paused(&fx.service.status()), vec![false, false]);
    }

    #[test]
    fn large_mode_ignores_small_windows_and_off_never_pauses() {
        let fx = fixture(
            "modes",
            WallpaperSettings {
                performance: PerformanceMode::Large,
                ..on("mar.mp4")
            },
        );
        fx.service.restore();

        *fx.covers.lock().unwrap() = vec![cover(1, 0.2), cover(1, 0.9)];
        fx.service.tick();
        assert_eq!(paused(&fx.service.status()), vec![false, true]);

        fx.service.update(|s| s.performance = PerformanceMode::Off);
        fx.service.tick();
        assert_eq!(paused(&fx.service.status()), vec![false, false]);
    }

    #[test]
    fn a_manual_pause_is_kept_apart_from_performance() {
        let fx = fixture("manual", on("mar.mp4"));
        fx.service.restore();
        *fx.covers.lock().unwrap() = vec![cover(1, 0.5), cover(1, 0.5)];

        let status = fx.service.update(|s| s.paused = true);
        fx.service.tick();

        assert!(status.manual_pause);
        // En pausa a mano no se mira nada más.
        assert_eq!(paused(&fx.service.status()), vec![false, false]);
        assert!(fx.service.status().manual_pause);

        fx.service.update(|s| s.paused = false);
        fx.service.tick();
        assert_eq!(paused(&fx.service.status()), vec![true, true]);
    }

    #[test]
    fn the_interface_is_told_only_when_something_changes() {
        let fx = fixture("events", on("mar.mp4"));
        fx.service.restore();
        let after_restore = wallpaper_events(&fx).len();

        for _ in 0..5 {
            fx.service.tick();
        }
        assert_eq!(wallpaper_events(&fx).len(), after_restore);

        *fx.covers.lock().unwrap() = vec![cover(1, 0.5), cover(0, 0.0)];
        fx.service.tick();
        fx.service.tick();
        assert_eq!(wallpaper_events(&fx).len(), after_restore + 1);
    }

    #[test]
    fn a_monitor_that_is_connected_while_running_gets_its_window_and_pause_state() {
        let fx = fixture("monitors", on("mar.mp4"));
        fx.service.restore();
        assert_eq!(fx.service.status().screens.len(), 2);

        fx.surface.connect(&["A", "B", "C"]);
        fx.service.tick();

        assert_eq!(fx.service.status().screens.len(), 3);
        assert_eq!(fx.surface.last_active(), vec![true, true, true]);
    }

    #[test]
    fn ticking_with_nothing_shown_only_keeps_the_monitor_list_up_to_date() {
        let fx = fixture("quiet", WallpaperSettings::default());
        fx.service.restore();
        assert_eq!(fx.service.status().screens.len(), 2);

        fx.surface.connect(&["A", "B", "C"]);
        fx.service.tick();

        assert_eq!(fx.service.status().screens.len(), 3);
        assert_eq!(fx.surface.syncs.load(Ordering::SeqCst), 0);
        assert_eq!(fx.surface.hides.load(Ordering::SeqCst), 0);
    }

    // ── un fondo para cada monitor ───────────────────────────────────────────────────────────

    #[test]
    fn with_one_wallpaper_for_all_the_monitor_argument_is_ignored() {
        let fx = fixture("shared", WallpaperSettings::default());

        let status = fx.service.select("mar.mp4", Some("B")).unwrap();

        assert_eq!(status.file.as_deref(), Some("mar.mp4"));
        assert!(status
            .screens
            .iter()
            .all(|s| s.file.as_deref() == Some("mar.mp4")));
        assert!(fx.service.settings().screens.is_empty());
    }

    #[test]
    fn with_a_wallpaper_per_monitor_each_one_gets_its_own_file() {
        let fx = fixture("per-screen", on("mar.mp4"));
        fx.service.restore();

        fx.service.update(|s| s.per_screen = true);
        let status = fx.service.select("montana.png", Some("B")).unwrap();

        assert!(status.per_screen);
        // A sigue con el de todos; B tiene el suyo.
        assert_eq!(status.screens[0].file.as_deref(), Some("mar.mp4"));
        assert_eq!(status.screens[0].kind, Some(MediaKind::Video));
        assert_eq!(status.screens[1].file.as_deref(), Some("montana.png"));
        assert_eq!(status.screens[1].kind, Some(MediaKind::Image));
        assert_eq!(status.file.as_deref(), Some("mar.mp4"));
        assert_eq!(fx.surface.last_active(), vec![true, true]);
    }

    #[test]
    fn a_monitor_with_no_wallpaper_gets_no_window() {
        let fx = fixture("one-window", WallpaperSettings::default());
        fx.service.update(|s| s.per_screen = true);

        fx.service.select("montana.png", Some("B")).unwrap();

        assert_eq!(fx.surface.last_active(), vec![false, true]);
        assert_eq!(fx.service.status().screens[0].file, None);

        // Si el único fondo se va, no queda ninguna ventana.
        fx.service.update(|s| s.enabled = false);
        assert_eq!(fx.surface.hides.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn going_back_to_one_wallpaper_keeps_what_each_monitor_had() {
        let fx = fixture("back-and-forth", on("mar.mp4"));
        fx.service.update(|s| s.per_screen = true);
        fx.service.select("montana.png", Some("B")).unwrap();

        let shared = fx.service.update(|s| s.per_screen = false);
        assert!(shared
            .screens
            .iter()
            .all(|s| s.file.as_deref() == Some("mar.mp4")));

        let split = fx.service.update(|s| s.per_screen = true);
        assert_eq!(split.screens[1].file.as_deref(), Some("montana.png"));
    }

    #[test]
    fn the_choice_for_a_monitor_that_is_unplugged_is_remembered() {
        let fx = fixture("unplugged", on("mar.mp4"));
        fx.service.update(|s| s.per_screen = true);
        fx.service.select("montana.png", Some("B")).unwrap();

        fx.surface.connect(&["A"]);
        fx.service.tick();
        assert_eq!(fx.service.status().screens.len(), 1);
        assert_eq!(fx.surface.last_active(), vec![true]);

        fx.surface.connect(&["A", "B"]);
        fx.service.tick();
        assert_eq!(
            fx.service.status().screens[1].file.as_deref(),
            Some("montana.png")
        );
    }

    // ── sonido ───────────────────────────────────────────────────────────────────────────────

    #[test]
    fn videos_are_silent_until_the_user_asks_for_sound() {
        let fx = fixture("silent", WallpaperSettings::default());

        let status = fx.service.select("con-audio.mp4", None).unwrap();

        assert!(!status.sound);
        assert!(status.screens.iter().all(|s| !s.sound && !s.audible));
        assert!(status.screens.iter().all(|s| s.has_audio == Some(true)));
    }

    #[test]
    fn sound_plays_only_in_videos_that_have_an_audio_track() {
        let fx = fixture("sound", WallpaperSettings::default());
        fx.service.select("con-audio.mp4", None).unwrap();

        let loud = fx.service.set_sound(true, None);
        assert!(loud.sound);
        assert!(loud.screens.iter().all(|s| s.sound));
        // El mismo video en dos monitores suena en uno solo (si no, se oiría doble).
        assert_eq!(
            loud.screens.iter().map(|s| s.audible).collect::<Vec<_>>(),
            vec![true, false]
        );

        // El video sin pista de audio no suena aunque se haya pedido sonido.
        let mute_video = fx.service.select("sin-audio.mp4", None).unwrap();
        assert!(mute_video.sound);
        assert!(mute_video
            .screens
            .iter()
            .all(|s| s.sound && s.has_audio == Some(false) && !s.audible));
    }

    #[test]
    fn an_image_is_never_audible() {
        let fx = fixture("image-sound", WallpaperSettings::default());
        fx.service.set_sound(true, None);

        let status = fx.service.select("montana.png", None).unwrap();

        assert!(status
            .screens
            .iter()
            .all(|s| s.has_audio.is_none() && !s.audible));
    }

    #[test]
    fn a_video_whose_audio_cannot_be_checked_still_plays_sound_when_asked() {
        let fx = fixture("unknown-audio", WallpaperSettings::default());
        fx.service.set_sound(true, None);

        // `mar.mp4` no es un video de verdad: no se puede saber, así que se respeta lo que se pidió.
        let status = fx.service.select("mar.mp4", None).unwrap();

        assert!(status.screens.iter().all(|s| s.has_audio.is_none()));
        assert!(status.screens[0].audible);
    }

    #[test]
    fn sound_can_be_chosen_for_one_monitor_only() {
        let fx = fixture("sound-per-screen", on("con-audio.mp4"));
        fx.service.update(|s| s.per_screen = true);

        let status = fx.service.set_sound(true, Some("B"));

        assert!(!status.sound);
        assert!(!status.screens[0].audible);
        assert!(status.screens[1].audible);

        // Con el mismo fondo en todos, el monitor se ignora y el sonido es para todos.
        fx.service.update(|s| s.per_screen = false);
        let shared = fx.service.set_sound(true, Some("A"));
        assert!(shared.sound);
        assert!(shared.screens[0].audible);
    }

    #[test]
    fn a_monitor_can_be_muted_while_the_rest_have_sound() {
        let fx = fixture(
            "mute-one",
            WallpaperSettings {
                sound: true,
                per_screen: true,
                ..on("con-audio.mp4")
            },
        );
        fx.service.restore();

        let status = fx.service.set_sound(false, Some("A"));

        assert!(!status.screens[0].audible);
        assert!(status.screens[1].audible);
    }

    #[test]
    fn the_same_video_never_plays_its_sound_on_two_monitors_at_once() {
        let fx = fixture(
            "no-echo",
            WallpaperSettings {
                sound: true,
                ..on("con-audio.mp4")
            },
        );
        fx.service.restore();

        let shared = fx.service.status();
        assert_eq!(
            shared.screens.iter().map(|s| s.audible).collect::<Vec<_>>(),
            vec![true, false]
        );
        // Los dos lo piden; solo uno lo reproduce.
        assert!(shared.screens.iter().all(|s| s.sound));

        // Si el primero se pausa por rendimiento, el sonido pasa al otro monitor.
        *fx.covers.lock().unwrap() = vec![cover(1, 0.5), cover(0, 0.0)];
        fx.service.tick();
        assert_eq!(
            fx.service
                .status()
                .screens
                .iter()
                .map(|s| s.audible)
                .collect::<Vec<_>>(),
            vec![false, true]
        );

        // Con videos distintos en cada monitor, suenan los dos.
        *fx.covers.lock().unwrap() = vec![ScreenCover::default(); 2];
        fx.service.tick();
        fx.service.update(|s| s.per_screen = true);
        let split = fx.service.select("mar.mp4", Some("B")).unwrap();
        assert!(split.screens[0].audible);
        assert!(split.screens[1].audible);
    }

    #[test]
    fn changing_the_sound_or_the_volume_does_not_touch_the_desktop() {
        let fx = fixture("sound-light", on("con-audio.mp4"));
        fx.service.restore();
        let syncs = fx.surface.syncs.load(Ordering::SeqCst);
        let events = wallpaper_events(&fx).len();

        fx.service.set_sound(true, None);
        fx.service.set_volume(20);

        assert_eq!(fx.surface.syncs.load(Ordering::SeqCst), syncs);
        assert_eq!(fx.surface.hides.load(Ordering::SeqCst), 0);
        // La interfaz sí se entera de cada cambio.
        assert_eq!(wallpaper_events(&fx).len(), events + 2);
        assert_eq!(fx.service.settings().volume, 20);
    }

    #[test]
    fn the_volume_is_cut_at_one_hundred() {
        let fx = fixture("volume", WallpaperSettings::default());
        assert_eq!(fx.service.status().volume, DEFAULT_VOLUME);

        assert_eq!(fx.service.set_volume(35).volume, 35);
        assert_eq!(fx.service.set_volume(250).volume, 100);
        assert_eq!(fx.service.set_volume(0).volume, 0);

        let saved = fixture(
            "volume-saved",
            WallpaperSettings {
                volume: 200,
                ..WallpaperSettings::default()
            },
        );
        assert_eq!(saved.service.status().volume, 100);
    }

    #[test]
    fn the_folder_list_says_which_videos_have_audio() {
        let fx = fixture("items-audio", WallpaperSettings::default());

        let audio_of = |file: &str| {
            fx.service
                .items()
                .into_iter()
                .find(|item| item.file == file)
                .unwrap()
                .has_audio
        };

        assert_eq!(audio_of("con-audio.mp4"), Some(true));
        assert_eq!(audio_of("sin-audio.mp4"), Some(false));
        assert_eq!(audio_of("mar.mp4"), None);
        assert_eq!(audio_of("montana.png"), None);
    }

    #[test]
    fn the_audio_is_checked_again_when_the_file_is_replaced() {
        let fx = fixture("audio-cache", on("sin-audio.mp4"));
        fx.service.restore();
        assert_eq!(fx.service.status().screens[0].has_audio, Some(false));

        // Mismo nombre, otro contenido (y otro tamaño): se vuelve a mirar.
        put(&fx.dir, "sin-audio.mp4", &audio::sample_mp4(true));

        assert_eq!(fx.service.status().screens[0].has_audio, Some(true));
    }

    // ── que la app nunca se congele ──────────────────────────────────────────────────────────

    fn plain_screen(key: &str) -> ScreenInfo {
        ScreenInfo {
            key: key.into(),
            label: None,
        }
    }

    /// Un "hilo principal" de mentira: atiende lo que le pide la superficie del fondo (como el hilo
    /// principal de Tauri atiende crear ventanas o leer monitores) y, entre un pedido y otro, lee el
    /// estado del servicio, como hacen las órdenes síncronas de la app.
    struct PretendMainThread {
        jobs: Mutex<std::sync::mpsc::Sender<std::sync::mpsc::Sender<()>>>,
        /// Cuántos pedidos se quedaron sin respuesta: cada uno sería un congelamiento.
        unanswered: Arc<AtomicUsize>,
    }

    impl PretendMainThread {
        fn run(&self) -> Result<(), WallpaperError> {
            let (done, wait) = std::sync::mpsc::channel();
            self.jobs
                .lock()
                .unwrap()
                .send(done)
                .map_err(|_| WallpaperError::Surface("sin hilo principal".into()))?;
            wait.recv_timeout(Duration::from_secs(10)).map_err(|_| {
                self.unanswered.fetch_add(1, Ordering::SeqCst);
                WallpaperError::Surface("el hilo principal no respondió".into())
            })
        }
    }

    impl Surface for Arc<PretendMainThread> {
        fn screens(&self) -> Result<Vec<ScreenInfo>, WallpaperError> {
            self.run()?;
            Ok(["A", "B"].map(plain_screen).to_vec())
        }
        fn sync(&self, _active: &[bool]) -> Result<(), WallpaperError> {
            self.run()
        }
        fn hide(&self) {
            let _ = self.run();
        }
    }

    #[test]
    fn many_threads_changing_the_wallpaper_never_freeze_the_main_thread() {
        // Regresión del congelamiento al abrir la app: el hilo principal lee el estado mientras otros
        // hilos cambian el fondo, y cambiar el fondo necesita al hilo principal. Si el servicio
        // sostuviera un candado durante ese cambio, los dos se esperarían para siempre. Aquí varios
        // hilos mezclan elegir archivos (de imagen y de video), sonido, pausas y vigilancia mientras
        // el "hilo principal" no deja de leer el estado.
        let dir = temp_dir("stress");
        put(&dir, "mar.mp4", &audio::sample_mp4(true));
        put(&dir, "montana.png", b"imagen");
        let (jobs, requests) = std::sync::mpsc::channel();
        let unanswered = Arc::new(AtomicUsize::new(0));
        let surface = Arc::new(PretendMainThread {
            jobs: Mutex::new(jobs),
            unanswered: Arc::clone(&unanswered),
        });
        let covers = Arc::new(Mutex::new(vec![cover(1, 0.5), cover(0, 0.0)]));
        let service = Arc::new(WallpaperService::new(
            dir.clone(),
            Box::new(surface),
            Box::new(FakeWatcher(covers)),
            Arc::new(FakeEventSink::default()),
            WallpaperSettings::default(),
        ));

        let stop = Arc::new(AtomicBool::new(false));
        let reads = Arc::new(AtomicUsize::new(0));
        let main_thread = {
            let (service, stop, reads) = (Arc::clone(&service), Arc::clone(&stop), reads.clone());
            thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    if let Ok(done) = requests.recv_timeout(Duration::from_millis(1)) {
                        let _ = done.send(());
                    }
                    let _ = service.status();
                    let _ = service.settings();
                    reads.fetch_add(1, Ordering::SeqCst);
                }
            })
        };

        let workers: Vec<_> = (0..4)
            .map(|id| {
                let service = Arc::clone(&service);
                thread::spawn(move || {
                    for step in 0..60 {
                        match (id + step) % 7 {
                            0 => drop(service.select("mar.mp4", Some("A"))),
                            1 => drop(service.select("montana.png", Some("B"))),
                            2 => drop(service.set_sound(step % 2 == 0, Some("B"))),
                            3 => drop(service.update(|s| s.per_screen = !s.per_screen)),
                            4 => service.tick(),
                            5 => drop(service.set_volume(u8::try_from(step % 100).unwrap_or(0))),
                            _ => drop(service.update(|s| s.enabled = !s.enabled)),
                        }
                    }
                })
            })
            .collect();
        let (finished, finish) = std::sync::mpsc::channel();
        thread::spawn(move || {
            for worker in workers {
                let _ = worker.join();
            }
            let _ = finished.send(());
        });

        assert!(
            finish.recv_timeout(Duration::from_secs(60)).is_ok(),
            "el servicio se quedó esperando al hilo principal (se congelaría la app)"
        );
        stop.store(true, Ordering::SeqCst);
        let _ = main_thread.join();
        assert!(reads.load(Ordering::SeqCst) > 0);
        assert_eq!(
            unanswered.load(Ordering::SeqCst),
            0,
            "el hilo principal tardó en responder: la app se habría congelado"
        );
        let _ = fs::remove_dir_all(dir);
    }

    /// Una superficie que, mientras cambia las ventanas, hace lo que hace el hilo principal de la app:
    /// leer el estado desde otro hilo y esperar la respuesta (como una orden síncrona de Tauri).
    struct StatusReadingSurface {
        service: Arc<std::sync::OnceLock<Arc<WallpaperService>>>,
        reads: Arc<AtomicUsize>,
        timeouts: Arc<AtomicUsize>,
    }

    impl StatusReadingSurface {
        fn read_status_meanwhile(&self) {
            if let Some(service) = self.service.get() {
                let service = Arc::clone(service);
                let (sender, receiver) = std::sync::mpsc::channel();
                thread::spawn(move || {
                    let _ = sender.send(service.status());
                });
                // Si el estado se quedara esperando un candado que ya tiene este hilo, aquí se agota.
                self.reads.fetch_add(1, Ordering::SeqCst);
                if receiver.recv_timeout(Duration::from_secs(3)).is_err() {
                    self.timeouts.fetch_add(1, Ordering::SeqCst);
                }
            }
        }
    }

    impl Surface for StatusReadingSurface {
        fn screens(&self) -> Result<Vec<ScreenInfo>, WallpaperError> {
            self.read_status_meanwhile();
            Ok(vec![plain_screen("A")])
        }
        fn sync(&self, _active: &[bool]) -> Result<(), WallpaperError> {
            self.read_status_meanwhile();
            Ok(())
        }
        fn hide(&self) {
            self.read_status_meanwhile();
        }
    }

    #[test]
    fn the_status_can_be_read_while_the_windows_are_being_changed() {
        let dir = temp_dir("main-thread");
        put(&dir, "mar.mp4", b"video");
        let service_slot = Arc::new(std::sync::OnceLock::new());
        let reads = Arc::new(AtomicUsize::new(0));
        let timeouts = Arc::new(AtomicUsize::new(0));
        let service = Arc::new(WallpaperService::new(
            dir.clone(),
            Box::new(StatusReadingSurface {
                service: Arc::clone(&service_slot),
                reads: Arc::clone(&reads),
                timeouts: Arc::clone(&timeouts),
            }),
            Box::new(FakeWatcher(Arc::default())),
            Arc::new(FakeEventSink::default()),
            on("mar.mp4"),
        ));
        let _ = service_slot.set(Arc::clone(&service));

        service.restore();
        assert!(reads.load(Ordering::SeqCst) > 0);
        assert_eq!(
            timeouts.load(Ordering::SeqCst),
            0,
            "el estado se leyó mientras se creaban las ventanas"
        );

        // Lo mismo con la vigilancia de cada segundo y al apagar el fondo.
        service.tick();
        service.update(|s| s.enabled = false);
        assert_eq!(
            timeouts.load(Ordering::SeqCst),
            0,
            "el estado se leyó mientras se acomodaban y quitaban las ventanas"
        );
        let _ = fs::remove_dir_all(dir);
    }

    // ── formato hacia la interfaz ────────────────────────────────────────────────────────────

    #[test]
    fn the_wire_format_matches_the_frontend() {
        let settings = WallpaperSettings::default();
        assert_eq!(
            serde_json::to_value(&settings).unwrap(),
            serde_json::json!({
                "enabled": false,
                "file": null,
                "sound": false,
                "volume": 60,
                "paused": false,
                "performance": "any",
                "perScreen": false,
                "screens": {}
            })
        );
        assert_eq!(
            serde_json::from_str::<WallpaperSettings>(r#"{"enabled":true,"performance":"large"}"#)
                .unwrap(),
            WallpaperSettings {
                enabled: true,
                performance: PerformanceMode::Large,
                ..WallpaperSettings::default()
            }
        );

        let status = WallpaperStatus {
            enabled: true,
            file: Some("mar.mp4".into()),
            sound: true,
            volume: 40,
            manual_pause: false,
            performance: PerformanceMode::Any,
            per_screen: true,
            screens: vec![ScreenStatus {
                key: "Monitor #41058".into(),
                label: Some("Built-in Retina Display".into()),
                file: Some("mar.mp4".into()),
                kind: Some(MediaKind::Video),
                path: Some("/x/mar.mp4".into()),
                sound: true,
                has_audio: Some(true),
                audible: true,
                missing: false,
                paused: true,
            }],
            folder: "/x".into(),
            error: None,
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({
                "enabled": true,
                "file": "mar.mp4",
                "sound": true,
                "volume": 40,
                "manualPause": false,
                "performance": "any",
                "perScreen": true,
                "screens": [{
                    "key": "Monitor #41058",
                    "label": "Built-in Retina Display",
                    "file": "mar.mp4",
                    "kind": "video",
                    "path": "/x/mar.mp4",
                    "sound": true,
                    "hasAudio": true,
                    "audible": true,
                    "missing": false,
                    "paused": true
                }],
                "folder": "/x",
                "error": null
            })
        );
    }

    #[test]
    fn settings_saved_before_sound_and_monitors_existed_still_load() {
        let old = r#"{"enabled":true,"file":"mar.mp4","paused":false,"performance":"large"}"#;

        let settings: WallpaperSettings = serde_json::from_str(old).unwrap();

        assert_eq!(settings.file.as_deref(), Some("mar.mp4"));
        assert_eq!(settings.performance, PerformanceMode::Large);
        assert!(!settings.sound);
        assert_eq!(settings.volume, DEFAULT_VOLUME);
        assert!(!settings.per_screen);
        assert!(settings.screens.is_empty());
    }

    #[test]
    fn settings_with_per_monitor_choices_round_trip() {
        let mut settings = on("mar.mp4");
        settings.per_screen = true;
        settings.sound = true;
        settings.screens.insert(
            "DELL U2720Q".into(),
            ScreenChoice {
                file: Some("montana.png".into()),
                sound: Some(false),
            },
        );

        let json = serde_json::to_string(&settings).unwrap();

        assert_eq!(
            serde_json::from_str::<WallpaperSettings>(&json).unwrap(),
            settings
        );
        assert!(json.contains(r#""DELL U2720Q":{"file":"montana.png","sound":false}"#));
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(
            WallpaperError::Surface(String::new()).code(),
            "wallpaper.surface"
        );
        assert_eq!(WallpaperError::Copy(String::new()).code(), "wallpaper.copy");
        assert_eq!(WallpaperError::NotFound.code(), "wallpaper.notFound");
        assert_eq!(
            WallpaperError::OpenFolder(String::new()).code(),
            "wallpaper.openFolder"
        );
    }
}
