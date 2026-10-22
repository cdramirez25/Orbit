//! Los modelos de transcripción en disco: cuáles están, su descarga (con progreso, cancelación y
//! verificación), su borrado y cuál se usa.
//!
//! Núcleo (§4.0): de dónde se baja cada modelo lo decide el puerto `ModelSource`; el adaptador de red
//! está en `model_source.rs` y lo elige el composition root (`lib.rs`). Así se prueba sin red.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::catalog::SttModel;
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

/// Una descarga abierta: el tamaño completo del modelo y el flujo de bytes desde donde se pidió.
pub struct Download {
    pub total: u64,
    pub reader: Box<dyn Read + Send>,
}

/// Puerto: de dónde sale un modelo.
pub trait ModelSource: Send + Sync {
    /// Abre la descarga a partir del byte `from` (0 = desde el principio). Así una conexión que se
    /// cae a la mitad se reanuda donde se quedó en vez de empezar de cero.
    fn open(&self, from: u64) -> Result<Download, ModelError>;
}

/// Un modelo que se puede bajar: qué se espera de su archivo y de dónde viene.
pub struct ModelSpec {
    pub model: SttModel,
    pub expected: Expected,
    pub source: Arc<dyn ModelSource>,
}

#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    #[error("no se pudo descargar el modelo: {0}")]
    Network(String),
    #[error("no se pudo guardar el modelo: {0}")]
    Disk(String),
    #[error("el modelo descargado no es el esperado")]
    Corrupt,
    #[error("se está descargando un modelo")]
    Busy,
    #[error("el modelo no está descargado")]
    NotReady,
    #[error("ese modelo no existe")]
    Unknown,
}

impl ModelError {
    /// Código estable para la interfaz (no cambia aunque cambie el texto).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Network(_) => "stt.model.network",
            Self::Disk(_) => "stt.model.disk",
            Self::Corrupt => "stt.model.corrupt",
            Self::Busy => "stt.model.busy",
            Self::NotReady => "stt.model.notReady",
            Self::Unknown => "stt.model.unknown",
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

/// Un modelo tal como lo ve la interfaz.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub model: SttModel,
    pub state: ModelState,
    /// Bytes descargados hasta ahora.
    pub downloaded: u64,
    /// Tamaño del modelo.
    pub total: u64,
    /// Código del último fallo de su descarga (`stt.model.*`); `None` si no hubo.
    pub error: Option<String>,
}

/// Lo que la interfaz ve de los modelos (espejo de `src/types/stt.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    /// El que usa el motor.
    pub active: SttModel,
    pub models: Vec<ModelEntry>,
    /// Carpeta donde están (o estarán) los modelos.
    pub dir: String,
    /// ¿Es una carpeta que eligió el usuario (y no la de la app)?
    pub custom_dir: bool,
}

#[derive(Default)]
struct Progress {
    /// El modelo que se está bajando; solo se baja uno a la vez.
    downloading: Option<SttModel>,
    downloaded: u64,
    /// El último fallo de la descarga de cada modelo.
    errors: HashMap<SttModel, &'static str>,
}

enum Outcome {
    Done,
    Cancelled,
}

pub struct ModelService {
    location: Arc<ModelLocation>,
    specs: Vec<ModelSpec>,
    events: Arc<dyn EventSink>,
    progress: Mutex<Progress>,
    cancel: AtomicBool,
    resume_delay: Duration,
}

impl ModelService {
    pub fn new(
        location: Arc<ModelLocation>,
        specs: Vec<ModelSpec>,
        events: Arc<dyn EventSink>,
    ) -> Self {
        Self {
            location,
            specs,
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

    fn spec(&self, model: SttModel) -> Result<&ModelSpec, ModelError> {
        self.specs
            .iter()
            .find(|spec| spec.model == model)
            .ok_or(ModelError::Unknown)
    }

    fn part_path(&self, model: SttModel) -> PathBuf {
        let mut name = self.location.path_of(model).into_os_string();
        name.push(".part");
        PathBuf::from(name)
    }

    fn entry(&self, spec: &ModelSpec, progress: &Progress) -> ModelEntry {
        let total = spec.expected.size;
        let (state, downloaded, error) = if progress.downloading == Some(spec.model) {
            (ModelState::Downloading, progress.downloaded, None)
        } else if self.location.path_of(spec.model).is_file() {
            (ModelState::Ready, total, None)
        } else {
            let error = progress
                .errors
                .get(&spec.model)
                .map(|code| (*code).to_owned());
            (ModelState::Missing, 0, error)
        };
        ModelEntry {
            model: spec.model,
            state,
            downloaded,
            total,
            error,
        }
    }

    pub fn status(&self) -> ModelStatus {
        let progress = self.lock();
        ModelStatus {
            active: self.location.active(),
            models: self
                .specs
                .iter()
                .map(|spec| self.entry(spec, &progress))
                .collect(),
            dir: self.location.dir().display().to_string(),
            custom_dir: self.location.is_custom(),
        }
    }

    fn publish(&self) {
        self.events.publish(DomainEvent::ModelStatus(self.status()));
    }

    /// Empieza a descargar un modelo en segundo plano y, si llega entero y verificado, ejecuta
    /// `then` (la app lo usa para dejarlo como modelo activo). Si ya está o ya se está bajando, no
    /// hace nada; si se está bajando otro, falla: se baja de uno en uno.
    pub fn download(
        self: &Arc<Self>,
        model: SttModel,
        then: impl FnOnce() + Send + 'static,
    ) -> Result<(), ModelError> {
        self.spec(model)?;
        {
            let mut progress = self.lock();
            match progress.downloading {
                Some(current) if current == model => return Ok(()),
                Some(_) => return Err(ModelError::Busy),
                None => {}
            }
            if self.location.path_of(model).is_file() {
                return Ok(());
            }
            progress.downloading = Some(model);
            progress.downloaded = 0;
            progress.errors.remove(&model);
        }
        self.cancel.store(false, Ordering::SeqCst);
        self.publish();

        let service = Arc::clone(self);
        thread::Builder::new()
            .name("orbit-model-download".into())
            .spawn(move || {
                if service.download_blocking(model) {
                    then();
                }
            })
            .map(|_| ())
            .map_err(|error| {
                self.lock().downloading = None;
                ModelError::Disk(error.to_string())
            })
    }

    /// Cancela la descarga en curso (se borra lo que se llevaba).
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Borra un modelo (y cualquier descarga a medias suya). Mientras se baja, no se puede.
    pub fn remove(&self, model: SttModel) -> Result<(), ModelError> {
        self.spec(model)?;
        if self.lock().downloading == Some(model) {
            return Err(ModelError::Busy);
        }
        for path in [self.location.path_of(model), self.part_path(model)] {
            remove_if_exists(&path)?;
        }
        self.lock().errors.remove(&model);
        self.publish();
        Ok(())
    }

    /// Elige el modelo que usa el motor. Tiene que estar descargado. No guarda el ajuste: eso lo
    /// hace quien llama.
    pub fn set_active(&self, model: SttModel) -> Result<(), ModelError> {
        self.spec(model)?;
        if !self.location.path_of(model).is_file() {
            return Err(ModelError::NotReady);
        }
        self.location.set_active(model);
        self.publish();
        Ok(())
    }

    /// Cambia la carpeta de los modelos (`None` = volver a la de la app). Los que ya estaban
    /// descargados se mueven a la carpeta nueva, salvo los que ahí ya existan: esos se usan tal cual
    /// y los de antes no se tocan. Con una descarga en curso no se puede. No guarda el ajuste: eso lo
    /// hace quien llama.
    pub fn set_dir(&self, dir: Option<PathBuf>) -> Result<(), ModelError> {
        if self.lock().downloading.is_some() {
            return Err(ModelError::Busy);
        }
        let new_dir = dir
            .clone()
            .unwrap_or_else(|| self.location.default_dir().clone());
        fs::create_dir_all(&new_dir).map_err(disk)?;
        check_writable(&new_dir)?;

        let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
        for spec in &self.specs {
            let old = self.location.path_of(spec.model);
            let new = new_dir.join(spec.model.file_name());
            if old == new || !old.is_file() || new.exists() {
                continue;
            }
            if let Err(error) = move_file(&old, &new) {
                // Que no quede la mitad en cada sitio: se devuelve lo ya movido.
                for (from, to) in moved.iter().rev() {
                    let _ = move_file(to, from);
                }
                return Err(error);
            }
            moved.push((old, new));
        }
        self.location.set_custom_dir(dir);
        self.publish();
        Ok(())
    }

    /// El cuerpo de la descarga: bloquea hasta terminar y dice si el modelo quedó descargado. Lo
    /// llama el hilo de `download`.
    pub(crate) fn download_blocking(&self, model: SttModel) -> bool {
        let outcome = self.spec(model).and_then(|spec| self.fetch(spec));
        {
            let mut progress = self.lock();
            progress.downloading = None;
            match &outcome {
                Err(error) => {
                    tracing::warn!(%error, ?model, "no se pudo descargar el modelo de transcripción");
                    progress.errors.insert(model, error.code());
                }
                Ok(_) => {
                    progress.errors.remove(&model);
                }
            }
        }
        let done = matches!(outcome, Ok(Outcome::Done));
        if done {
            tracing::info!(?model, "modelo de transcripción descargado");
        }
        self.publish();
        done
    }

    fn fetch(&self, spec: &ModelSpec) -> Result<Outcome, ModelError> {
        let path = self.location.path_of(spec.model);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(disk)?;
        }
        let part = self.part_path(spec.model);
        let mut transfer = Transfer {
            file: File::create(&part).map_err(disk)?,
            hasher: Sha256::new(),
            downloaded: 0,
        };

        let mut resumes = 0;
        let outcome = loop {
            match self.transfer(spec, &mut transfer) {
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
    fn transfer(&self, spec: &ModelSpec, transfer: &mut Transfer) -> Result<Outcome, ModelError> {
        if self.cancel.load(Ordering::SeqCst) {
            return Ok(Outcome::Cancelled);
        }
        let Download { total, mut reader } = spec.source.open(transfer.downloaded)?;
        if total != spec.expected.size {
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
            if transfer.downloaded > spec.expected.size {
                return Err(ModelError::Corrupt);
            }
            if last_report.elapsed() >= PROGRESS_EVERY {
                self.lock().downloaded = transfer.downloaded;
                self.publish();
                last_report = Instant::now();
            }
        }

        if transfer.downloaded != spec.expected.size {
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
        if digest != spec.expected.sha256 {
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
    use std::sync::mpsc;

    use super::*;
    use crate::events::testing::FakeEventSink;

    /// El archivo de `SttModel::Small`, el modelo con el que se prueba casi todo.
    const SMALL: &str = "ggml-small.bin";
    const BASE: &str = "ggml-base.bin";

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

    fn spec(model: SttModel, data: &[u8], source: impl ModelSource + 'static) -> ModelSpec {
        ModelSpec {
            model,
            expected: expected_for(data),
            source: Arc::new(source),
        }
    }

    struct Fixture {
        service: Arc<ModelService>,
        location: Arc<ModelLocation>,
        events: Arc<FakeEventSink>,
    }

    /// Un servicio sobre `dir/models` con esos modelos (el activo es `Small`).
    fn fixture(dir: &Path, specs: Vec<ModelSpec>) -> Fixture {
        let events = Arc::new(FakeEventSink::default());
        let location = Arc::new(ModelLocation::new(
            dir.join("models"),
            None,
            SttModel::Small,
        ));
        let service = Arc::new(
            ModelService::new(
                Arc::clone(&location),
                specs,
                Arc::clone(&events) as Arc<dyn EventSink>,
            )
            .with_resume_delay(Duration::ZERO),
        );
        Fixture {
            service,
            location,
            events,
        }
    }

    /// Un servicio con solo `Small`, que sirve `source`.
    fn small(dir: &Path, data: &[u8], source: FakeSource) -> Fixture {
        fixture(dir, vec![spec(SttModel::Small, data, source)])
    }

    fn entry(service: &ModelService, model: SttModel) -> ModelEntry {
        service
            .status()
            .models
            .into_iter()
            .find(|entry| entry.model == model)
            .unwrap()
    }

    fn wait_until_done(service: &ModelService) {
        for _ in 0..500 {
            if service
                .status()
                .models
                .iter()
                .all(|entry| entry.state != ModelState::Downloading)
            {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("la descarga no terminó");
    }

    #[test]
    fn a_missing_model_reports_its_expected_size() {
        let dir = temp_dir("missing");
        let fx = small(&dir, b"abc", FakeSource::serving(b"abc"));
        assert_eq!(
            fx.service.status(),
            ModelStatus {
                active: SttModel::Small,
                models: vec![ModelEntry {
                    model: SttModel::Small,
                    state: ModelState::Missing,
                    downloaded: 0,
                    total: 3,
                    error: None,
                }],
                dir: dir.join("models").display().to_string(),
                custom_dir: false,
            }
        );
    }

    #[test]
    fn downloading_saves_a_verified_model_and_reports_each_step() {
        let dir = temp_dir("ok");
        let data = vec![7_u8; 300_000];
        let fx = small(&dir, &data, FakeSource::serving(&data));

        fx.service.download(SttModel::Small, || {}).unwrap();
        wait_until_done(&fx.service);

        let small = entry(&fx.service, SttModel::Small);
        assert_eq!(small.state, ModelState::Ready);
        assert_eq!(small.downloaded, data.len() as u64);
        assert_eq!(fs::read(dir.join("models").join(SMALL)).unwrap(), data);
        assert!(!dir.join("models/ggml-small.bin.part").exists());

        let states: Vec<ModelState> = fx
            .events
            .events()
            .into_iter()
            .filter_map(|event| match event {
                DomainEvent::ModelStatus(status) => status
                    .models
                    .iter()
                    .find(|entry| entry.model == SttModel::Small)
                    .map(|entry| entry.state),
                _ => None,
            })
            .collect();
        assert_eq!(states.first(), Some(&ModelState::Downloading));
        assert_eq!(states.last(), Some(&ModelState::Ready));
    }

    #[test]
    fn a_finished_download_runs_the_follow_up_but_a_failed_one_does_not() {
        let dir = temp_dir("then");
        let fx = small(&dir, b"abc", FakeSource::serving(b"abc"));
        let (sender, receiver) = mpsc::channel();
        let notify = sender.clone();
        fx.service
            .download(SttModel::Small, move || notify.send(()).unwrap())
            .unwrap();
        receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(entry(&fx.service, SttModel::Small).state, ModelState::Ready);

        let dir = temp_dir("then-corrupt");
        let fx = small(&dir, b"abc", FakeSource::serving(b"xyz"));
        fx.service
            .download(SttModel::Small, move || sender.send(()).unwrap())
            .unwrap();
        wait_until_done(&fx.service);
        // Si el seguimiento corriera, ya habría llegado.
        thread::sleep(Duration::from_millis(50));
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn a_model_that_is_already_there_is_not_downloaded_again() {
        let dir = temp_dir("present");
        let fx = small(&dir, b"abc", FakeSource::serving(b"abc"));
        fs::create_dir_all(dir.join("models")).unwrap();
        fs::write(dir.join("models").join(SMALL), b"mine").unwrap();

        fx.service.download(SttModel::Small, || {}).unwrap();

        assert_eq!(entry(&fx.service, SttModel::Small).state, ModelState::Ready);
        assert!(fx.events.events().is_empty());
        assert_eq!(fs::read(dir.join("models").join(SMALL)).unwrap(), b"mine");
    }

    #[test]
    fn an_unknown_model_is_refused() {
        let dir = temp_dir("unknown");
        let fx = small(&dir, b"abc", FakeSource::serving(b"abc"));

        let error = fx.service.download(SttModel::Medium, || {}).unwrap_err();
        assert_eq!(error.code(), "stt.model.unknown");
        assert_eq!(
            fx.service.remove(SttModel::Medium).unwrap_err().code(),
            "stt.model.unknown"
        );
        assert_eq!(
            fx.service.set_active(SttModel::Medium).unwrap_err().code(),
            "stt.model.unknown"
        );
    }

    #[test]
    fn a_download_with_the_wrong_content_is_discarded() {
        let dir = temp_dir("corrupt");
        let fx = small(&dir, b"abc", FakeSource::serving(b"xyz"));

        fx.service.download_blocking(SttModel::Small);

        let small = entry(&fx.service, SttModel::Small);
        assert_eq!(small.state, ModelState::Missing);
        assert_eq!(small.error.as_deref(), Some("stt.model.corrupt"));
        assert!(!dir.join("models").join(SMALL).exists());
        assert!(!dir.join("models/ggml-small.bin.part").exists());
    }

    #[test]
    fn a_download_that_is_cut_short_fails_with_a_network_error() {
        let dir = temp_dir("short");
        let source = FakeSource {
            data: b"ab".to_vec(),
            announced: 3,
            fail: false,
        };
        let fx = small(&dir, b"abc", source);

        fx.service.download_blocking(SttModel::Small);

        assert_eq!(
            entry(&fx.service, SttModel::Small).error.as_deref(),
            Some("stt.model.network")
        );
        assert!(!dir.join("models/ggml-small.bin.part").exists());
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
        let fx = fixture(
            &dir,
            vec![ModelSpec {
                model: SttModel::Small,
                expected: expected_for(&data),
                source: Arc::clone(&source) as Arc<dyn ModelSource>,
            }],
        );

        assert!(fx.service.download_blocking(SttModel::Small));

        let small = entry(&fx.service, SttModel::Small);
        assert_eq!(small.error, None);
        assert_eq!(small.state, ModelState::Ready);
        assert_eq!(fs::read(dir.join("models").join(SMALL)).unwrap(), data);
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
        let fx = small(&dir, b"abc", source);

        fx.service.download_blocking(SttModel::Small);

        assert_eq!(
            entry(&fx.service, SttModel::Small).error.as_deref(),
            Some("stt.model.corrupt")
        );
    }

    #[test]
    fn a_source_that_cannot_be_opened_reports_the_error_and_allows_a_retry() {
        let dir = temp_dir("offline");
        let source = FakeSource {
            data: Vec::new(),
            announced: 0,
            fail: true,
        };
        let fx = small(&dir, b"abc", source);

        assert!(!fx.service.download_blocking(SttModel::Small));
        assert_eq!(
            entry(&fx.service, SttModel::Small).error.as_deref(),
            Some("stt.model.network")
        );

        // Reintentar vuelve a pedir el modelo (aquí falla igual: la fuente sigue sin red).
        fx.service.download(SttModel::Small, || {}).unwrap();
        wait_until_done(&fx.service);
        assert_eq!(
            entry(&fx.service, SttModel::Small).error.as_deref(),
            Some("stt.model.network")
        );
    }

    #[test]
    fn cancelling_leaves_nothing_behind() {
        let dir = temp_dir("cancel");
        let data = vec![1_u8; 200_000];
        let fx = small(&dir, &data, FakeSource::serving(&data));

        fx.service.cancel();
        // `download_blocking` no reinicia la bandera: `download` sí. Aquí se prueba el corte directo.
        assert!(!fx.service.download_blocking(SttModel::Small));

        let small = entry(&fx.service, SttModel::Small);
        assert_eq!(small.state, ModelState::Missing);
        assert_eq!(small.error, None);
        assert!(!dir.join("models").join(SMALL).exists());
        assert!(!dir.join("models/ggml-small.bin.part").exists());
    }

    #[test]
    fn removing_deletes_the_model_and_any_partial_download() {
        let dir = temp_dir("remove");
        let fx = small(&dir, b"abc", FakeSource::serving(b"abc"));
        fs::create_dir_all(dir.join("models")).unwrap();
        fs::write(dir.join("models").join(SMALL), b"abc").unwrap();
        fs::write(dir.join("models/ggml-small.bin.part"), b"ab").unwrap();
        assert_eq!(entry(&fx.service, SttModel::Small).state, ModelState::Ready);

        fx.service.remove(SttModel::Small).unwrap();

        assert_eq!(
            entry(&fx.service, SttModel::Small).state,
            ModelState::Missing
        );
        assert!(!dir.join("models/ggml-small.bin.part").exists());
        assert!(matches!(
            fx.events.events().last(),
            Some(DomainEvent::ModelStatus(status))
                if status.models[0].state == ModelState::Missing
        ));
        // Borrar lo que no está tampoco falla.
        fx.service.remove(SttModel::Small).unwrap();
    }

    #[test]
    fn a_model_in_the_middle_of_downloading_cannot_be_removed() {
        let dir = temp_dir("busy");
        let fx = small(&dir, b"abc", FakeSource::serving(b"abc"));
        fx.service.lock().downloading = Some(SttModel::Small);

        let error = fx.service.remove(SttModel::Small).unwrap_err();
        assert_eq!(error.code(), "stt.model.busy");
    }

    /// Dos modelos con contenidos distintos: `Base` (`b"base"`) y `Small` (`b"small!"`).
    fn two_models(dir: &Path) -> Fixture {
        fixture(
            dir,
            vec![
                spec(SttModel::Base, b"base", FakeSource::serving(b"base")),
                spec(SttModel::Small, b"small!", FakeSource::serving(b"small!")),
            ],
        )
    }

    #[test]
    fn each_model_has_its_own_file_state_and_error() {
        let dir = temp_dir("two");
        let fx = two_models(&dir);

        fx.service.download(SttModel::Base, || {}).unwrap();
        wait_until_done(&fx.service);

        assert_eq!(fs::read(dir.join("models").join(BASE)).unwrap(), b"base");
        assert_eq!(entry(&fx.service, SttModel::Base).state, ModelState::Ready);
        assert_eq!(entry(&fx.service, SttModel::Base).total, 4);
        assert_eq!(
            entry(&fx.service, SttModel::Small).state,
            ModelState::Missing
        );
        assert_eq!(entry(&fx.service, SttModel::Small).total, 6);
        assert_eq!(
            fx.service
                .status()
                .models
                .iter()
                .map(|entry| entry.model)
                .collect::<Vec<_>>(),
            vec![SttModel::Base, SttModel::Small]
        );
    }

    #[test]
    fn only_one_model_downloads_at_a_time() {
        let dir = temp_dir("one-at-a-time");
        let fx = two_models(&dir);
        fx.service.lock().downloading = Some(SttModel::Small);

        let error = fx.service.download(SttModel::Base, || {}).unwrap_err();
        assert_eq!(error.code(), "stt.model.busy");
        // Pedir el mismo que ya se baja no es un error ni lo duplica.
        fx.service.download(SttModel::Small, || {}).unwrap();
        // Borrar el otro sí se puede mientras tanto.
        fx.service.remove(SttModel::Base).unwrap();
    }

    #[test]
    fn a_model_must_be_downloaded_before_it_can_be_chosen() {
        let dir = temp_dir("choose");
        let fx = two_models(&dir);

        let error = fx.service.set_active(SttModel::Base).unwrap_err();
        assert_eq!(error.code(), "stt.model.notReady");
        assert_eq!(fx.location.active(), SttModel::Small);

        fx.service.download(SttModel::Base, || {}).unwrap();
        wait_until_done(&fx.service);
        fx.service.set_active(SttModel::Base).unwrap();

        assert_eq!(fx.location.active(), SttModel::Base);
        assert_eq!(fx.service.status().active, SttModel::Base);
        assert_eq!(fx.location.path(), dir.join("models").join(BASE));
        assert!(matches!(
            fx.events.events().last(),
            Some(DomainEvent::ModelStatus(status)) if status.active == SttModel::Base
        ));
    }

    fn put(dir: &Path, file: &str, content: &[u8]) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(file), content).unwrap();
    }

    #[test]
    fn changing_the_folder_moves_every_downloaded_model_and_back() {
        let dir = temp_dir("move");
        let fx = two_models(&dir);
        put(&dir.join("models"), SMALL, b"small!");
        put(&dir.join("models"), BASE, b"base");
        let other = dir.join("externo");

        fx.service.set_dir(Some(other.clone())).unwrap();

        assert_eq!(fx.location.path(), other.join(SMALL));
        assert_eq!(fs::read(other.join(SMALL)).unwrap(), b"small!");
        assert_eq!(fs::read(other.join(BASE)).unwrap(), b"base");
        assert!(!dir.join("models").join(SMALL).exists());
        assert!(!dir.join("models").join(BASE).exists());
        let status = fx.service.status();
        assert!(status
            .models
            .iter()
            .all(|entry| entry.state == ModelState::Ready));
        assert!(status.custom_dir);
        assert_eq!(status.dir, other.display().to_string());

        fx.service.set_dir(None).unwrap();
        assert_eq!(fs::read(dir.join("models").join(SMALL)).unwrap(), b"small!");
        assert_eq!(fs::read(dir.join("models").join(BASE)).unwrap(), b"base");
        assert!(!other.join(SMALL).exists());
        assert!(!fx.service.status().custom_dir);
    }

    #[test]
    fn changing_the_folder_with_no_model_yet_only_changes_where_it_will_go() {
        let dir = temp_dir("move-empty");
        let fx = two_models(&dir);
        let other = dir.join("otro");

        fx.service.set_dir(Some(other.clone())).unwrap();

        assert_eq!(
            entry(&fx.service, SttModel::Small).state,
            ModelState::Missing
        );
        assert!(other.is_dir(), "la carpeta nueva se crea");
        assert_eq!(fx.location.path(), other.join(SMALL));
    }

    #[test]
    fn a_model_already_in_the_new_folder_is_used_and_the_old_one_is_left_alone() {
        let dir = temp_dir("move-existing");
        let fx = two_models(&dir);
        put(&dir.join("models"), SMALL, b"viejo");
        put(&dir.join("models"), BASE, b"base");
        let other = dir.join("otro");
        put(&other, SMALL, b"nuevo");

        fx.service.set_dir(Some(other.clone())).unwrap();

        assert_eq!(fs::read(other.join(SMALL)).unwrap(), b"nuevo");
        assert_eq!(fs::read(dir.join("models").join(SMALL)).unwrap(), b"viejo");
        // El que no estaba allí sí se movió.
        assert_eq!(fs::read(other.join(BASE)).unwrap(), b"base");
    }

    #[test]
    fn a_folder_that_cannot_be_written_is_refused_and_nothing_changes() {
        let dir = temp_dir("move-bad");
        let fx = two_models(&dir);
        put(&dir.join("models"), SMALL, b"small!");
        // "Carpeta" que en realidad es un archivo: no se puede crear nada dentro.
        let blocker = dir.join("archivo");
        fs::write(&blocker, b"x").unwrap();

        let error = fx
            .service
            .set_dir(Some(blocker.join("dentro")))
            .unwrap_err();

        assert_eq!(error.code(), "stt.model.disk");
        assert!(!fx.location.is_custom());
        assert_eq!(fs::read(dir.join("models").join(SMALL)).unwrap(), b"small!");
    }

    #[test]
    fn the_folder_cannot_change_during_a_download() {
        let dir = temp_dir("move-busy");
        let fx = two_models(&dir);
        fx.service.lock().downloading = Some(SttModel::Base);
        let error = fx.service.set_dir(Some(dir.join("x"))).unwrap_err();
        assert_eq!(error.code(), "stt.model.busy");
    }

    #[test]
    fn a_download_goes_to_the_chosen_folder() {
        let dir = temp_dir("move-download");
        let data = vec![5_u8; 70_000];
        let fx = small(&dir, &data, FakeSource::serving(&data));
        let other = dir.join("disco");
        fx.service.set_dir(Some(other.clone())).unwrap();

        assert!(fx.service.download_blocking(SttModel::Small));

        assert_eq!(entry(&fx.service, SttModel::Small).state, ModelState::Ready);
        assert_eq!(fs::read(other.join(SMALL)).unwrap(), data);
        assert!(!dir.join("models").join(SMALL).exists());
        assert_eq!(fx.location.path(), other.join(SMALL));
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
        assert_eq!(ModelError::NotReady.code(), "stt.model.notReady");
        assert_eq!(ModelError::Unknown.code(), "stt.model.unknown");
    }

    #[test]
    fn the_wire_format_matches_the_frontend() {
        let status = ModelStatus {
            active: SttModel::Turbo,
            models: vec![ModelEntry {
                model: SttModel::Medium,
                state: ModelState::Downloading,
                downloaded: 10,
                total: 20,
                error: None,
            }],
            dir: "/modelos".into(),
            custom_dir: true,
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({
                "active": "turbo",
                "models": [{
                    "model": "medium",
                    "state": "downloading",
                    "downloaded": 10,
                    "total": 20,
                    "error": null
                }],
                "dir": "/modelos",
                "customDir": true
            })
        );
    }
}
