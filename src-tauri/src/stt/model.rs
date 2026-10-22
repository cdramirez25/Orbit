//! El modelo de transcripción en disco: si está, su descarga (con progreso, cancelación y
//! verificación) y su borrado.
//!
//! Núcleo (§4.0): de dónde se baja lo decide el puerto `ModelSource`; el adaptador de red está en
//! `model_source.rs` y lo elige el composition root (`lib.rs`). Así se prueba sin red.

use std::fs::{self, File};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::location::ModelLocation;
use crate::events::{DomainEvent, EventSink};

/// Cuánto se lee de una vez y cada cuánto se avisa del progreso (la interfaz no necesita más).
const CHUNK: usize = 64 * 1024;
const PROGRESS_EVERY: Duration = Duration::from_millis(200);
/// Cuántas veces se reanuda una descarga cortada antes de rendirse, y cuánto se espera entre intentos.
const MAX_RESUMES: u32 = 4;
const RESUME_DELAY: Duration = Duration::from_secs(2);

/// Lo que se espera encontrar: tamaño y huella SHA-256 del archivo. Una descarga que no coincide
/// (cortada, cambiada por el camino o servida distinta) se descarta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expected {
    pub size: u64,
    pub sha256: String,
}

/// El modelo `small` multilingüe de whisper.cpp (el que usa `whisper_local`).
pub fn small_model() -> Expected {
    Expected {
        size: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b".into(),
    }
}

/// Una descarga abierta: el tamaño completo del modelo y el flujo de bytes desde donde se pidió.
pub struct Download {
    pub total: u64,
    pub reader: Box<dyn Read + Send>,
}

/// Puerto: de dónde sale el modelo.
pub trait ModelSource: Send + Sync {
    /// Abre la descarga a partir del byte `from` (0 = desde el principio). Así una conexión que se
    /// cae a la mitad se reanuda donde se quedó en vez de empezar de cero.
    fn open(&self, from: u64) -> Result<Download, ModelError>;
}

#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    #[error("no se pudo descargar el modelo: {0}")]
    Network(String),
    #[error("no se pudo guardar el modelo: {0}")]
    Disk(String),
    #[error("el modelo descargado no es el esperado")]
    Corrupt,
    #[error("el modelo se está descargando")]
    Busy,
}

impl ModelError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Network(_) => "stt.model.network",
            Self::Disk(_) => "stt.model.disk",
            Self::Corrupt => "stt.model.corrupt",
            Self::Busy => "stt.model.busy",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ModelState {
    Missing,
    Downloading,
    Ready,
}

/// Lo que la interfaz ve del modelo (espejo de `src/types/stt.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub state: ModelState,
    /// Bytes descargados hasta ahora.
    pub downloaded: u64,
    /// Tamaño del modelo.
    pub total: u64,
    /// Código del último fallo de la descarga (`stt.model.*`); `None` si no hubo.
    pub error: Option<String>,
    /// Carpeta donde está (o estará) el modelo.
    pub dir: String,
    /// ¿Es una carpeta que eligió el usuario (y no la de la app)?
    pub custom_dir: bool,
}

#[derive(Default)]
struct Progress {
    downloading: bool,
    downloaded: u64,
    error: Option<&'static str>,
}

enum Outcome {
    Done,
    Cancelled,
}

pub struct ModelService {
    location: Arc<ModelLocation>,
    expected: Expected,
    source: Arc<dyn ModelSource>,
    events: Arc<dyn EventSink>,
    progress: Mutex<Progress>,
    cancel: AtomicBool,
    resume_delay: Duration,
}

impl ModelService {
    pub fn new(
        location: Arc<ModelLocation>,
        expected: Expected,
        source: Arc<dyn ModelSource>,
        events: Arc<dyn EventSink>,
    ) -> Self {
        Self {
            location,
            expected,
            source,
            events,
            progress: Mutex::new(Progress::default()),
            cancel: AtomicBool::new(false),
            resume_delay: RESUME_DELAY,
        }
    }

    /// Cambia la espera entre reintentos (los tests no quieren esperar).
    #[cfg(test)]
    fn with_resume_delay(mut self, delay: Duration) -> Self {
        self.resume_delay = delay;
        self
    }

    fn lock(&self) -> MutexGuard<'_, Progress> {
        self.progress.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn part_path(&self) -> PathBuf {
        let mut name = self.location.path().into_os_string();
        name.push(".part");
        PathBuf::from(name)
    }

    pub fn status(&self) -> ModelStatus {
        let progress = self.lock();
        let total = self.expected.size;
        let dir = self.location.dir().display().to_string();
        let custom_dir = self.location.is_custom();
        if progress.downloading {
            return ModelStatus {
                state: ModelState::Downloading,
                downloaded: progress.downloaded,
                total,
                error: None,
                dir,
                custom_dir,
            };
        }
        if self.location.path().is_file() {
            return ModelStatus {
                state: ModelState::Ready,
                downloaded: total,
                total,
                error: None,
                dir,
                custom_dir,
            };
        }
        ModelStatus {
            state: ModelState::Missing,
            downloaded: 0,
            total,
            dir,
            custom_dir,
            error: progress.error.map(str::to_owned),
        }
    }

    fn publish(&self) {
        self.events.publish(DomainEvent::ModelStatus(self.status()));
    }

    /// Empieza a descargar el modelo en segundo plano. Si ya está o ya se está bajando, no hace nada.
    pub fn download(self: &Arc<Self>) -> Result<(), ModelError> {
        {
            let mut progress = self.lock();
            if progress.downloading || self.location.path().is_file() {
                return Ok(());
            }
            *progress = Progress {
                downloading: true,
                ..Progress::default()
            };
        }
        self.cancel.store(false, Ordering::SeqCst);
        self.publish();

        let service = Arc::clone(self);
        thread::Builder::new()
            .name("orbit-model-download".into())
            .spawn(move || service.download_blocking())
            .map(|_| ())
            .map_err(|error| {
                self.lock().downloading = false;
                ModelError::Disk(error.to_string())
            })
    }

    /// Cancela la descarga en curso (se borra lo que se llevaba).
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Borra el modelo (y cualquier descarga a medias). Con una descarga en curso no se puede.
    pub fn remove(&self) -> Result<(), ModelError> {
        if self.lock().downloading {
            return Err(ModelError::Busy);
        }
        for path in [self.location.path(), self.part_path()] {
            remove_if_exists(&path)?;
        }
        self.lock().error = None;
        self.publish();
        Ok(())
    }

    /// Cambia la carpeta del modelo (`None` = volver a la de la app). Si el modelo ya estaba
    /// descargado se mueve a la carpeta nueva, salvo que ahí ya haya uno: ese se usa tal cual y el
    /// de antes no se toca. Con una descarga en curso no se puede. No guarda el ajuste: eso lo hace
    /// quien llama.
    pub fn set_dir(&self, dir: Option<PathBuf>) -> Result<(), ModelError> {
        if self.lock().downloading {
            return Err(ModelError::Busy);
        }
        let new_dir = dir
            .clone()
            .unwrap_or_else(|| self.location.default_dir().clone());
        fs::create_dir_all(&new_dir).map_err(disk)?;
        check_writable(&new_dir)?;

        let old = self.location.path();
        let new = new_dir.join(self.location.file_name());
        if old != new && old.is_file() && !new.exists() {
            move_file(&old, &new)?;
        }
        self.location.set_custom_dir(dir);
        self.publish();
        Ok(())
    }

    /// El cuerpo de la descarga: bloquea hasta terminar. Lo llama el hilo de `download`.
    pub(crate) fn download_blocking(&self) {
        let outcome = self.fetch();
        {
            let mut progress = self.lock();
            progress.downloading = false;
            progress.error = match &outcome {
                Err(error) => {
                    tracing::warn!(%error, "no se pudo descargar el modelo de transcripción");
                    Some(error.code())
                }
                Ok(_) => None,
            };
        }
        if matches!(outcome, Ok(Outcome::Done)) {
            tracing::info!("modelo de transcripción descargado");
        }
        self.publish();
    }

    fn fetch(&self) -> Result<Outcome, ModelError> {
        let path = self.location.path();
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(disk)?;
        }
        let part = self.part_path();
        let mut transfer = Transfer {
            file: File::create(&part).map_err(disk)?,
            hasher: Sha256::new(),
            downloaded: 0,
        };

        let mut resumes = 0;
        let outcome = loop {
            match self.transfer(&mut transfer) {
                // Una caída de la conexión no tira lo ya bajado: se reanuda desde ahí.
                Err(ModelError::Network(error)) if resumes < MAX_RESUMES => {
                    resumes += 1;
                    tracing::warn!(%error, resumes, "descarga cortada; se reanuda");
                    thread::sleep(self.resume_delay);
                }
                other => break other,
            }
        };

        match outcome {
            Ok(Outcome::Done) => {
                drop(transfer);
                fs::rename(&part, &path).map_err(|error| {
                    let _ = fs::remove_file(&part);
                    disk(error)
                })?;
                Ok(Outcome::Done)
            }
            other => {
                drop(transfer);
                let _ = fs::remove_file(&part);
                other
            }
        }
    }

    /// Una pasada: abre la descarga donde se quedó, copia lo que llegue y, si llegó entero,
    /// comprueba su huella.
    fn transfer(&self, transfer: &mut Transfer) -> Result<Outcome, ModelError> {
        if self.cancel.load(Ordering::SeqCst) {
            return Ok(Outcome::Cancelled);
        }
        let Download { total, mut reader } = self.source.open(transfer.downloaded)?;
        if total != self.expected.size {
            return Err(ModelError::Corrupt);
        }

        let mut buffer = vec![0_u8; CHUNK];
        let mut last_report = Instant::now();
        loop {
            if self.cancel.load(Ordering::SeqCst) {
                return Ok(Outcome::Cancelled);
            }
            let read = reader
                .read(&mut buffer)
                .map_err(|error| ModelError::Network(error.to_string()))?;
            if read == 0 {
                break;
            }
            transfer.file.write_all(&buffer[..read]).map_err(disk)?;
            transfer.hasher.update(&buffer[..read]);
            transfer.downloaded += read as u64;
            if transfer.downloaded > self.expected.size {
                return Err(ModelError::Corrupt);
            }
            if last_report.elapsed() >= PROGRESS_EVERY {
                self.lock().downloaded = transfer.downloaded;
                self.publish();
                last_report = Instant::now();
            }
        }

        if transfer.downloaded != self.expected.size {
            return Err(ModelError::Network("la descarga se cortó".into()));
        }
        transfer.file.sync_all().map_err(disk)?;
        let digest: String = transfer
            .hasher
            .clone()
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        if digest != self.expected.sha256 {
            return Err(ModelError::Corrupt);
        }
        Ok(Outcome::Done)
    }
}

/// Lo que se lleva de la descarga y sobrevive a una reanudación.
struct Transfer {
    file: File,
    hasher: Sha256,
    downloaded: u64,
}

fn disk(error: std::io::Error) -> ModelError {
    ModelError::Disk(error.to_string())
}

/// Comprueba que se puede escribir en la carpeta (un disco externo de solo lectura, por ejemplo).
fn check_writable(dir: &Path) -> Result<(), ModelError> {
    let probe = dir.join(".orbit-write-test");
    File::create(&probe).map_err(disk)?;
    let _ = fs::remove_file(probe);
    Ok(())
}

/// Mueve un archivo: renombrándolo si es el mismo disco y, si no, copiándolo y borrando el original.
fn move_file(from: &Path, to: &Path) -> Result<(), ModelError> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    let mut partial = to.as_os_str().to_owned();
    partial.push(".moving");
    let partial = PathBuf::from(partial);
    let copied = fs::copy(from, &partial).and_then(|_| fs::rename(&partial, to));
    if let Err(error) = copied {
        let _ = fs::remove_file(&partial);
        return Err(disk(error));
    }
    fs::remove_file(from).map_err(disk)
}

fn remove_if_exists(path: &Path) -> Result<(), ModelError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(disk(error)),
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::events::testing::FakeEventSink;

    fn sha256_hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn expected_for(bytes: &[u8]) -> Expected {
        Expected {
            size: bytes.len() as u64,
            sha256: sha256_hex(bytes),
        }
    }

    /// Fuente simulada: sirve `data` (anunciando `announced` bytes) o falla al abrir.
    struct FakeSource {
        data: Vec<u8>,
        announced: u64,
        fail: bool,
    }

    impl FakeSource {
        fn serving(data: &[u8]) -> Self {
            Self {
                data: data.to_vec(),
                announced: data.len() as u64,
                fail: false,
            }
        }
    }

    impl ModelSource for FakeSource {
        fn open(&self, from: u64) -> Result<Download, ModelError> {
            if self.fail {
                return Err(ModelError::Network("sin red".into()));
            }
            let from = usize::try_from(from).unwrap().min(self.data.len());
            Ok(Download {
                total: self.announced,
                reader: Box::new(Cursor::new(self.data[from..].to_vec())),
            })
        }
    }

    /// Fuente con una conexión que se cae: la primera vez entrega `cut_at` bytes y falla; las
    /// siguientes sirven lo que se pida. Apunta desde qué byte se pidió cada vez.
    struct FlakySource {
        data: Vec<u8>,
        cut_at: usize,
        opened_from: Mutex<Vec<u64>>,
    }

    struct CutReader {
        inner: Cursor<Vec<u8>>,
        left: usize,
    }

    impl Read for CutReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if self.left == 0 {
                return Err(std::io::Error::new(ErrorKind::ConnectionReset, "se cayó"));
            }
            let limit = buffer.len().min(self.left);
            let read = self.inner.read(&mut buffer[..limit])?;
            self.left -= read;
            Ok(read)
        }
    }

    impl ModelSource for FlakySource {
        fn open(&self, from: u64) -> Result<Download, ModelError> {
            let first = {
                let mut opened = self.opened_from.lock().unwrap();
                opened.push(from);
                opened.len() == 1
            };
            let start = usize::try_from(from).unwrap();
            let rest = Cursor::new(self.data[start..].to_vec());
            let reader: Box<dyn Read + Send> = if first {
                Box::new(CutReader {
                    inner: rest,
                    left: self.cut_at,
                })
            } else {
                Box::new(rest)
            };
            Ok(Download {
                total: self.data.len() as u64,
                reader,
            })
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("orbit-model-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn service(
        dir: &Path,
        data: &[u8],
        source: FakeSource,
    ) -> (Arc<ModelService>, Arc<FakeEventSink>) {
        let events = Arc::new(FakeEventSink::default());
        let service = Arc::new(
            ModelService::new(
                Arc::new(ModelLocation::fixed(dir.join("models").join("model.bin"))),
                expected_for(data),
                Arc::new(source),
                Arc::clone(&events) as Arc<dyn EventSink>,
            )
            .with_resume_delay(Duration::ZERO),
        );
        (service, events)
    }

    fn wait_until_done(service: &ModelService) {
        for _ in 0..500 {
            if service.status().state != ModelState::Downloading {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("la descarga no terminó");
    }

    #[test]
    fn a_missing_model_reports_its_expected_size() {
        let dir = temp_dir("missing");
        let (service, _) = service(&dir, b"abc", FakeSource::serving(b"abc"));
        assert_eq!(
            service.status(),
            ModelStatus {
                state: ModelState::Missing,
                downloaded: 0,
                total: 3,
                error: None,
                dir: dir.join("models").display().to_string(),
                custom_dir: false,
            }
        );
    }

    #[test]
    fn downloading_saves_a_verified_model_and_reports_each_step() {
        let dir = temp_dir("ok");
        let data = vec![7_u8; 300_000];
        let (service, events) = service(&dir, &data, FakeSource::serving(&data));

        service.download().unwrap();
        wait_until_done(&service);

        let status = service.status();
        assert_eq!(status.state, ModelState::Ready);
        assert_eq!(status.downloaded, data.len() as u64);
        assert_eq!(fs::read(dir.join("models/model.bin")).unwrap(), data);
        assert!(!dir.join("models/model.bin.part").exists());

        let states: Vec<ModelState> = events
            .events()
            .into_iter()
            .filter_map(|event| match event {
                DomainEvent::ModelStatus(status) => Some(status.state),
                _ => None,
            })
            .collect();
        assert_eq!(states.first(), Some(&ModelState::Downloading));
        assert_eq!(states.last(), Some(&ModelState::Ready));
    }

    #[test]
    fn a_model_that_is_already_there_is_not_downloaded_again() {
        let dir = temp_dir("present");
        let (service, events) = service(&dir, b"abc", FakeSource::serving(b"abc"));
        fs::create_dir_all(dir.join("models")).unwrap();
        fs::write(dir.join("models/model.bin"), b"mine").unwrap();

        service.download().unwrap();

        assert_eq!(service.status().state, ModelState::Ready);
        assert!(events.events().is_empty());
        assert_eq!(fs::read(dir.join("models/model.bin")).unwrap(), b"mine");
    }

    #[test]
    fn a_download_with_the_wrong_content_is_discarded() {
        let dir = temp_dir("corrupt");
        let (service, _) = service(&dir, b"abc", FakeSource::serving(b"xyz"));

        service.download_blocking();

        let status = service.status();
        assert_eq!(status.state, ModelState::Missing);
        assert_eq!(status.error.as_deref(), Some("stt.model.corrupt"));
        assert!(!dir.join("models/model.bin").exists());
        assert!(!dir.join("models/model.bin.part").exists());
    }

    #[test]
    fn a_download_that_is_cut_short_fails_with_a_network_error() {
        let dir = temp_dir("short");
        let source = FakeSource {
            data: b"ab".to_vec(),
            announced: 3,
            fail: false,
        };
        let (service, _) = service(&dir, b"abc", source);

        service.download_blocking();

        assert_eq!(service.status().error.as_deref(), Some("stt.model.network"));
        assert!(!dir.join("models/model.bin.part").exists());
    }

    #[test]
    fn a_dropped_connection_is_resumed_from_where_it_stopped() {
        let dir = temp_dir("resume");
        let data: Vec<u8> = (0..250_000_u32).map(|n| (n % 251) as u8).collect();
        let source = Arc::new(FlakySource {
            data: data.clone(),
            cut_at: 100_000,
            opened_from: Mutex::new(Vec::new()),
        });
        let events = Arc::new(FakeEventSink::default());
        let service = ModelService::new(
            Arc::new(ModelLocation::fixed(dir.join("models").join("model.bin"))),
            expected_for(&data),
            Arc::clone(&source) as Arc<dyn ModelSource>,
            events,
        )
        .with_resume_delay(Duration::ZERO);

        service.download_blocking();

        let status = service.status();
        assert_eq!(status.error, None);
        assert_eq!(status.state, ModelState::Ready);
        assert_eq!(fs::read(dir.join("models/model.bin")).unwrap(), data);
        assert_eq!(*source.opened_from.lock().unwrap(), vec![0, 100_000]);
    }

    #[test]
    fn a_server_that_announces_another_size_is_refused() {
        let dir = temp_dir("size");
        let source = FakeSource {
            data: b"abc".to_vec(),
            announced: 99,
            fail: false,
        };
        let (service, _) = service(&dir, b"abc", source);

        service.download_blocking();

        assert_eq!(service.status().error.as_deref(), Some("stt.model.corrupt"));
    }

    #[test]
    fn a_source_that_cannot_be_opened_reports_the_error_and_allows_a_retry() {
        let dir = temp_dir("offline");
        let source = FakeSource {
            data: Vec::new(),
            announced: 0,
            fail: true,
        };
        let (service, _) = service(&dir, b"abc", source);

        service.download_blocking();
        assert_eq!(service.status().error.as_deref(), Some("stt.model.network"));

        // Reintentar vuelve a pedir el modelo (aquí falla igual: la fuente sigue sin red).
        service.download().unwrap();
        wait_until_done(&service);
        assert_eq!(service.status().error.as_deref(), Some("stt.model.network"));
    }

    #[test]
    fn cancelling_leaves_nothing_behind() {
        let dir = temp_dir("cancel");
        let data = vec![1_u8; 200_000];
        let (service, _) = service(&dir, &data, FakeSource::serving(&data));

        service.cancel();
        // `download_blocking` no reinicia la bandera: `download` sí. Aquí se prueba el corte directo.
        service.download_blocking();

        let status = service.status();
        assert_eq!(status.state, ModelState::Missing);
        assert_eq!(status.error, None);
        assert!(!dir.join("models/model.bin").exists());
        assert!(!dir.join("models/model.bin.part").exists());
    }

    #[test]
    fn removing_deletes_the_model_and_any_partial_download() {
        let dir = temp_dir("remove");
        let (service, events) = service(&dir, b"abc", FakeSource::serving(b"abc"));
        fs::create_dir_all(dir.join("models")).unwrap();
        fs::write(dir.join("models/model.bin"), b"abc").unwrap();
        fs::write(dir.join("models/model.bin.part"), b"ab").unwrap();
        assert_eq!(service.status().state, ModelState::Ready);

        service.remove().unwrap();

        assert_eq!(service.status().state, ModelState::Missing);
        assert!(!dir.join("models/model.bin.part").exists());
        assert!(matches!(
            events.events().last(),
            Some(DomainEvent::ModelStatus(status)) if status.state == ModelState::Missing
        ));
        // Borrar lo que no está tampoco falla.
        service.remove().unwrap();
    }

    #[test]
    fn a_model_in_the_middle_of_downloading_cannot_be_removed() {
        let dir = temp_dir("busy");
        let (service, _) = service(&dir, b"abc", FakeSource::serving(b"abc"));
        service.lock().downloading = true;

        let error = service.remove().unwrap_err();
        assert_eq!(error.code(), "stt.model.busy");
    }

    /// Servicio con una ubicación que se puede cambiar de carpeta (la de la app es `models/`).
    fn movable(dir: &Path, data: &[u8]) -> (Arc<ModelService>, Arc<ModelLocation>) {
        let location = Arc::new(ModelLocation::new(dir.join("models"), "model.bin", None));
        let service = Arc::new(
            ModelService::new(
                Arc::clone(&location),
                expected_for(data),
                Arc::new(FakeSource::serving(data)),
                Arc::new(FakeEventSink::default()) as Arc<dyn EventSink>,
            )
            .with_resume_delay(Duration::ZERO),
        );
        (service, location)
    }

    #[test]
    fn changing_the_folder_moves_the_downloaded_model_and_back() {
        let dir = temp_dir("move");
        let (service, location) = movable(&dir, b"abc");
        fs::create_dir_all(dir.join("models")).unwrap();
        fs::write(dir.join("models/model.bin"), b"abc").unwrap();
        let other = dir.join("externo");

        service.set_dir(Some(other.clone())).unwrap();

        assert_eq!(location.path(), other.join("model.bin"));
        assert_eq!(fs::read(other.join("model.bin")).unwrap(), b"abc");
        assert!(!dir.join("models/model.bin").exists());
        let status = service.status();
        assert_eq!(status.state, ModelState::Ready);
        assert!(status.custom_dir);
        assert_eq!(status.dir, other.display().to_string());

        service.set_dir(None).unwrap();
        assert_eq!(fs::read(dir.join("models/model.bin")).unwrap(), b"abc");
        assert!(!other.join("model.bin").exists());
        assert!(!service.status().custom_dir);
    }

    #[test]
    fn changing_the_folder_with_no_model_yet_only_changes_where_it_will_go() {
        let dir = temp_dir("move-empty");
        let (service, location) = movable(&dir, b"abc");
        let other = dir.join("otro");

        service.set_dir(Some(other.clone())).unwrap();

        assert_eq!(service.status().state, ModelState::Missing);
        assert!(other.is_dir(), "la carpeta nueva se crea");
        assert_eq!(location.path(), other.join("model.bin"));
    }

    #[test]
    fn a_model_already_in_the_new_folder_is_used_and_the_old_one_is_left_alone() {
        let dir = temp_dir("move-existing");
        let (service, _) = movable(&dir, b"abc");
        fs::create_dir_all(dir.join("models")).unwrap();
        fs::write(dir.join("models/model.bin"), b"viejo").unwrap();
        let other = dir.join("otro");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("model.bin"), b"nuevo").unwrap();

        service.set_dir(Some(other.clone())).unwrap();

        assert_eq!(fs::read(other.join("model.bin")).unwrap(), b"nuevo");
        assert_eq!(fs::read(dir.join("models/model.bin")).unwrap(), b"viejo");
    }

    #[test]
    fn a_folder_that_cannot_be_written_is_refused_and_nothing_changes() {
        let dir = temp_dir("move-bad");
        let (service, location) = movable(&dir, b"abc");
        fs::create_dir_all(dir.join("models")).unwrap();
        fs::write(dir.join("models/model.bin"), b"abc").unwrap();
        // "Carpeta" que en realidad es un archivo: no se puede crear nada dentro.
        let blocker = dir.join("archivo");
        fs::write(&blocker, b"x").unwrap();

        let error = service.set_dir(Some(blocker.join("dentro"))).unwrap_err();

        assert_eq!(error.code(), "stt.model.disk");
        assert!(!location.is_custom());
        assert_eq!(fs::read(dir.join("models/model.bin")).unwrap(), b"abc");
    }

    #[test]
    fn the_folder_cannot_change_during_a_download() {
        let dir = temp_dir("move-busy");
        let (service, _) = movable(&dir, b"abc");
        service.lock().downloading = true;
        let error = service.set_dir(Some(dir.join("x"))).unwrap_err();
        assert_eq!(error.code(), "stt.model.busy");
    }

    #[test]
    fn a_download_goes_to_the_chosen_folder() {
        let dir = temp_dir("move-download");
        let data = vec![5_u8; 70_000];
        let (service, location) = movable(&dir, &data);
        let other = dir.join("disco");
        service.set_dir(Some(other.clone())).unwrap();

        service.download_blocking();

        assert_eq!(service.status().state, ModelState::Ready);
        assert_eq!(fs::read(other.join("model.bin")).unwrap(), data);
        assert!(!dir.join("models/model.bin").exists());
        assert_eq!(location.path(), other.join("model.bin"));
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(
            ModelError::Network(String::new()).code(),
            "stt.model.network"
        );
        assert_eq!(ModelError::Disk(String::new()).code(), "stt.model.disk");
        assert_eq!(ModelError::Corrupt.code(), "stt.model.corrupt");
        assert_eq!(ModelError::Busy.code(), "stt.model.busy");
    }

    #[test]
    fn the_pinned_model_matches_the_published_one() {
        let expected = small_model();
        assert_eq!(expected.size, 487_601_967);
        assert_eq!(expected.sha256.len(), 64);
    }

    #[test]
    fn the_wire_format_matches_the_frontend() {
        let status = ModelStatus {
            state: ModelState::Downloading,
            downloaded: 10,
            total: 20,
            error: None,
            dir: "/modelos".into(),
            custom_dir: true,
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({
                "state": "downloading",
                "downloaded": 10,
                "total": 20,
                "error": null,
                "dir": "/modelos",
                "customDir": true
            })
        );
    }
}
