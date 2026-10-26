//! Fondo de pantalla animado, al estilo Wallpaper Engine: una imagen o un video a pantalla completa
//! detrás de los iconos del escritorio, en cada monitor. Los archivos los pone el usuario en una
//! carpeta que crea la app (`Imágenes/Orbit/Wallpapers`).
//!
//! Núcleo (§4.0): aquí viven la lista de archivos, los ajustes, las reglas de pausa y el servicio que
//! las aplica. Las ventanas del escritorio las crea el puerto `Surface` (`surface.rs`) y las ventanas
//! abiertas del usuario las mira el puerto `WindowWatcher` (`platform/`); los dos los elige el
//! composition root (`lib.rs`). Así se prueba sin tocar el escritorio de nadie.
//!
//! Siempre sin sonido: el video nunca reproduce audio. Si Orbit se cierra, las ventanas desaparecen y
//! el escritorio vuelve a su fondo de siempre: no se cambia nada del sistema.

pub mod platform;
pub mod surface;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
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

/// Lo que el usuario eligió. Es lo que se guarda en los ajustes.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WallpaperSettings {
    /// ¿Se muestra el fondo?
    pub enabled: bool,
    /// Nombre del archivo elegido, dentro de la carpeta de fondos.
    pub file: Option<String>,
    /// Pausa a mano (el fondo se queda congelado hasta reanudarlo).
    pub paused: bool,
    pub performance: PerformanceMode,
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
}

/// Lo que ven las ventanas de fondo y la página de Ajustes. Espejo de `WallpaperStatus` en TS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperStatus {
    pub enabled: bool,
    pub file: Option<String>,
    pub kind: Option<MediaKind>,
    /// Ruta completa del archivo elegido (si existe).
    pub path: Option<String>,
    /// Pausa a mano.
    pub manual_pause: bool,
    pub performance: PerformanceMode,
    /// Por monitor (en el orden de sus ventanas): ¿está en pausa por el modo rendimiento?
    pub screen_paused: Vec<bool>,
    /// El archivo elegido ya no está en la carpeta.
    pub missing: bool,
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

/// Puerto: las ventanas del escritorio donde se dibuja el fondo (una por monitor).
pub trait Surface: Send + Sync {
    /// Deja una ventana por monitor, bien colocada, y devuelve cuántos monitores hay. Se puede
    /// llamar todo el tiempo: si nada cambió, no hace nada.
    fn sync(&self) -> Result<usize, WallpaperError>;
    /// Cierra todas las ventanas de fondo.
    fn hide(&self);
}

/// Puerto: mira qué ventanas de otras apps hay abiertas sobre cada monitor.
pub trait WindowWatcher: Send + Sync {
    /// Una entrada por monitor, en el mismo orden que las ventanas del fondo.
    fn covers(&self) -> Result<Vec<ScreenCover>, WallpaperError>;
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
/// lista archivos ocultos.
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
                file,
            })
        })
        .collect();
    items.sort_by_key(|item| item.file.to_lowercase());
    items.truncate(MAX_ITEMS);
    items
}

/// El archivo elegido, si sigue en la carpeta. Un nombre con rutas (`../x.png`) nunca vale: solo se
/// sirven archivos de esa carpeta.
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

struct Inner {
    settings: WallpaperSettings,
    /// ¿Están las ventanas de fondo en el escritorio?
    shown: bool,
    screen_paused: Vec<bool>,
    error: Option<&'static str>,
}

pub struct WallpaperService {
    dir: PathBuf,
    surface: Box<dyn Surface>,
    watcher: Box<dyn WindowWatcher>,
    events: Arc<dyn EventSink>,
    inner: Mutex<Inner>,
}

impl WallpaperService {
    /// Crea la carpeta de fondos si no existe. `settings` es lo que estaba guardado: `restore` lo
    /// aplica.
    pub fn new(
        dir: PathBuf,
        surface: Box<dyn Surface>,
        watcher: Box<dyn WindowWatcher>,
        events: Arc<dyn EventSink>,
        settings: WallpaperSettings,
    ) -> Self {
        if let Err(error) = fs::create_dir_all(&dir) {
            tracing::warn!(%error, "no se pudo crear la carpeta de fondos");
        }
        Self {
            dir,
            surface,
            watcher,
            events,
            inner: Mutex::new(Inner {
                settings,
                shown: false,
                screen_paused: Vec::new(),
                error: None,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn folder(&self) -> &Path {
        &self.dir
    }

    /// Los archivos que hay ahora en la carpeta.
    pub fn items(&self) -> Vec<WallpaperItem> {
        list_items(&self.dir)
    }

    /// Lo que está elegido, para guardarlo en los ajustes.
    pub fn settings(&self) -> WallpaperSettings {
        self.lock().settings.clone()
    }

    fn view(&self, inner: &Inner) -> WallpaperStatus {
        let item = inner
            .settings
            .file
            .as_deref()
            .and_then(|file| find_item(&self.dir, file));
        WallpaperStatus {
            enabled: inner.settings.enabled,
            file: inner.settings.file.clone(),
            kind: item.as_ref().map(|item| item.kind),
            path: item.as_ref().map(|item| item.path.clone()),
            manual_pause: inner.settings.paused,
            performance: inner.settings.performance,
            screen_paused: inner.screen_paused.clone(),
            missing: inner.settings.file.is_some() && item.is_none(),
            folder: self.dir.display().to_string(),
            error: inner.error.map(str::to_owned),
        }
    }

    pub fn status(&self) -> WallpaperStatus {
        self.view(&self.lock())
    }

    /// Deja las ventanas de fondo como piden los ajustes: puestas si hay un fondo elegido y
    /// activado, y quitadas si no.
    fn reconcile(&self, inner: &mut Inner) {
        let playable = inner.settings.enabled
            && inner
                .settings
                .file
                .as_deref()
                .and_then(|file| find_item(&self.dir, file))
                .is_some();
        if playable {
            match self.surface.sync() {
                Ok(screens) => {
                    inner.shown = true;
                    inner.error = None;
                    inner.screen_paused.resize(screens, false);
                }
                Err(error) => {
                    tracing::warn!(%error, "no se pudo mostrar el fondo de pantalla");
                    inner.error = Some(error.code());
                    inner.shown = false;
                    inner.screen_paused.clear();
                }
            }
        } else {
            if inner.shown {
                self.surface.hide();
            }
            inner.shown = false;
            inner.error = None;
            inner.screen_paused.clear();
        }
    }

    /// Cambia los ajustes y los aplica ya. Guardarlos en disco lo hace quien llama.
    pub fn update(&self, change: impl FnOnce(&mut WallpaperSettings)) -> WallpaperStatus {
        let status = {
            let mut inner = self.lock();
            change(&mut inner.settings);
            self.reconcile(&mut inner);
            self.view(&inner)
        };
        self.events.publish(DomainEvent::Wallpaper(status.clone()));
        status
    }

    /// Elige un archivo de la carpeta y lo activa. Falla si ya no está.
    pub fn select(&self, file: &str) -> Result<WallpaperStatus, WallpaperError> {
        if find_item(&self.dir, file).is_none() {
            return Err(WallpaperError::NotFound);
        }
        Ok(self.update(|settings| {
            settings.file = Some(file.to_owned());
            settings.enabled = true;
        }))
    }

    /// Aplica lo guardado al arrancar la app.
    pub fn restore(&self) {
        self.update(|_| {});
    }

    /// Revisa los monitores y las ventanas abiertas y pausa o reanuda cada fondo. Avisa a la interfaz
    /// solo si algo cambió.
    pub fn tick(&self) {
        let changed = {
            let mut inner = self.lock();
            if !inner.shown {
                return;
            }
            // Si se conectó o quitó un monitor, las ventanas se acomodan.
            let before = self.view(&inner);
            match self.surface.sync() {
                Ok(screens) => inner.screen_paused.resize(screens, false),
                Err(error) => {
                    tracing::warn!(%error, "no se pudo acomodar el fondo de pantalla");
                }
            }
            let screens = inner.screen_paused.len();
            let mode = inner.settings.performance;
            // En pausa a mano o con el modo apagado no hace falta mirar las ventanas.
            let paused = if inner.settings.paused || mode == PerformanceMode::Off {
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
            inner.screen_paused = paused;
            let after = self.view(&inner);
            (before != after).then_some(after)
        };
        if let Some(status) = changed {
            self.events.publish(DomainEvent::Wallpaper(status));
        }
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

    // ── servicio ─────────────────────────────────────────────────────────────────────────────

    struct FakeSurface {
        screens: AtomicUsize,
        syncs: AtomicUsize,
        hides: AtomicUsize,
        fail: AtomicBool,
    }

    impl Surface for Arc<FakeSurface> {
        fn sync(&self) -> Result<usize, WallpaperError> {
            self.syncs.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err(WallpaperError::Surface("sin ventana".into()));
            }
            Ok(self.screens.load(Ordering::SeqCst))
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
        let surface = Arc::new(FakeSurface {
            screens: AtomicUsize::new(2),
            syncs: AtomicUsize::new(0),
            hides: AtomicUsize::new(0),
            fail: AtomicBool::new(false),
        });
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

        let surface = Arc::new(FakeSurface {
            screens: AtomicUsize::new(1),
            syncs: AtomicUsize::new(0),
            hides: AtomicUsize::new(0),
            fail: AtomicBool::new(false),
        });
        let _service = WallpaperService::new(
            dir.clone(),
            Box::new(surface),
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
        assert_eq!(status.path, None);
        assert!(!status.missing);
        assert_eq!(status.folder, fx.dir.display().to_string());
    }

    #[test]
    fn choosing_a_file_turns_it_on_and_puts_a_window_on_every_screen() {
        let fx = fixture("select", WallpaperSettings::default());

        let status = fx.service.select("mar.mp4").unwrap();

        assert!(status.enabled);
        assert_eq!(status.file.as_deref(), Some("mar.mp4"));
        assert_eq!(status.kind, Some(MediaKind::Video));
        assert_eq!(
            status.path,
            Some(fx.dir.join("mar.mp4").display().to_string())
        );
        assert_eq!(status.screen_paused, vec![false, false]);
        assert_eq!(fx.surface.syncs.load(Ordering::SeqCst), 1);
        assert_eq!(wallpaper_events(&fx).last(), Some(&status));
        assert_eq!(fx.service.settings(), on("mar.mp4"));
    }

    #[test]
    fn choosing_a_file_that_is_gone_is_an_error_and_changes_nothing() {
        let fx = fixture("gone", on("mar.mp4"));
        fx.service.restore();

        let error = fx.service.select("borrado.mp4").unwrap_err();

        assert_eq!(error.code(), "wallpaper.notFound");
        assert_eq!(fx.service.settings(), on("mar.mp4"));
        assert!(fx.service.select("../x.png").is_err());
    }

    #[test]
    fn what_was_saved_is_restored_on_start() {
        let fx = fixture("restore", on("montana.png"));
        fx.service.restore();
        assert_eq!(fx.surface.syncs.load(Ordering::SeqCst), 1);
        assert_eq!(fx.service.status().kind, Some(MediaKind::Image));
    }

    #[test]
    fn turning_it_off_takes_the_windows_away_and_turning_it_on_brings_them_back() {
        let fx = fixture("toggle", on("mar.mp4"));
        fx.service.restore();

        let off = fx.service.update(|s| s.enabled = false);
        assert!(!off.enabled);
        assert_eq!(fx.surface.hides.load(Ordering::SeqCst), 1);
        assert!(off.screen_paused.is_empty());
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
        assert!(status.missing);
        assert_eq!(status.path, None);
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
        assert_eq!(fx.service.status().screen_paused, vec![false, true]);

        // Se cierra: el fondo vuelve a moverse.
        *fx.covers.lock().unwrap() = vec![cover(0, 0.0), cover(0, 0.0)];
        fx.service.tick();
        assert_eq!(fx.service.status().screen_paused, vec![false, false]);
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
        assert_eq!(fx.service.status().screen_paused, vec![false, true]);

        fx.service.update(|s| s.performance = PerformanceMode::Off);
        fx.service.tick();
        assert_eq!(fx.service.status().screen_paused, vec![false, false]);
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
        assert_eq!(fx.service.status().screen_paused, vec![false, false]);
        assert!(fx.service.status().manual_pause);

        fx.service.update(|s| s.paused = false);
        fx.service.tick();
        assert_eq!(fx.service.status().screen_paused, vec![true, true]);
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
    fn a_monitor_that_is_connected_while_running_gets_its_own_pause_state() {
        let fx = fixture("monitors", on("mar.mp4"));
        fx.service.restore();
        assert_eq!(fx.service.status().screen_paused.len(), 2);

        fx.surface.screens.store(3, Ordering::SeqCst);
        fx.service.tick();

        assert_eq!(fx.service.status().screen_paused.len(), 3);
    }

    #[test]
    fn ticking_with_nothing_shown_does_not_touch_the_desktop() {
        let fx = fixture("quiet", WallpaperSettings::default());
        fx.service.tick();
        assert_eq!(fx.surface.syncs.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn the_wire_format_matches_the_frontend() {
        let settings = WallpaperSettings::default();
        assert_eq!(
            serde_json::to_value(&settings).unwrap(),
            serde_json::json!({
                "enabled": false,
                "file": null,
                "paused": false,
                "performance": "any"
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
            kind: Some(MediaKind::Video),
            path: Some("/x/mar.mp4".into()),
            manual_pause: false,
            performance: PerformanceMode::Any,
            screen_paused: vec![false, true],
            missing: false,
            folder: "/x".into(),
            error: None,
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({
                "enabled": true,
                "file": "mar.mp4",
                "kind": "video",
                "path": "/x/mar.mp4",
                "manualPause": false,
                "performance": "any",
                "screenPaused": [false, true],
                "missing": false,
                "folder": "/x",
                "error": null
            })
        );
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
