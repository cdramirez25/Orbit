//! Historial del portapapeles (textos e imágenes), solo en memoria: al cerrar la app se pierde.
//!
//! Núcleo: el puerto `ClipboardPort`, el historial y `ClipboardService`. El adaptador real
//! (`system.rs`, con `arboard`) y los detectores de cambios por sistema (`platform/`) se eligen
//! en el composition root. Nunca se registra el contenido copiado en los logs.

pub mod history;
pub mod image;
pub mod platform;
pub mod system;

use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::events::{DomainEvent, EventSink};
use history::{EntryView, History};
use image::RgbaImage;

/// Cada cuánto se comprueba si cambió el portapapeles (es una consulta barata de un contador).
const POLL_EVERY: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, PartialEq)]
pub enum Content {
    Text(String),
    Image(RgbaImage),
}

#[derive(Debug, thiserror::Error)]
pub enum ClipboardError {
    #[error("no se pudo leer o escribir el portapapeles: {0}")]
    System(String),
    #[error("ese elemento ya no está en el historial")]
    NotFound,
    #[error("no se pudo procesar la imagen: {0}")]
    Image(String),
    #[error("ese elemento no es un texto")]
    NotText,
}

impl ClipboardError {
    /// Código estable para la interfaz.
    pub fn code(&self) -> &'static str {
        match self {
            Self::System(_) => "clipboard.system",
            Self::NotFound => "clipboard.notFound",
            Self::Image(_) => "clipboard.image",
            Self::NotText => "clipboard.notText",
        }
    }
}

/// Puerto: el portapapeles del sistema.
pub trait ClipboardPort: Send + Sync {
    /// Contador que cambia cada vez que algo se copia. Es barato de consultar.
    fn change_count(&self) -> u64;
    /// ¿Lo copiado es sensible (gestor de contraseñas, dato temporal)? Entonces no se guarda.
    fn is_sensitive(&self) -> bool;
    /// Contenido actual: texto o imagen. `None` si hay otra cosa (archivos…) o está vacío.
    fn read(&self) -> Result<Option<Content>, ClipboardError>;
    fn write(&self, content: &Content) -> Result<(), ClipboardError>;
}

struct State {
    history: History,
    /// Último valor visto del contador; `None` hasta la primera comprobación, para que lo que
    /// ya estaba copiado al abrir Orbit también entre en el historial.
    last_change: Option<u64>,
}

pub struct ClipboardService {
    port: Box<dyn ClipboardPort>,
    events: Arc<dyn EventSink>,
    state: Mutex<State>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(0))
}

impl ClipboardService {
    pub fn new(port: Box<dyn ClipboardPort>, events: Arc<dyn EventSink>) -> Self {
        Self {
            port,
            events,
            state: Mutex::new(State {
                history: History::default(),
                last_change: None,
            }),
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Comprueba si cambió el portapapeles y, si es así, guarda lo nuevo. Devuelve si el
    /// historial cambió.
    pub fn poll(&self) -> bool {
        self.poll_at(now_ms())
    }

    fn poll_at(&self, now_ms: u64) -> bool {
        let count = self.port.change_count();
        {
            let mut state = self.state();
            if state.last_change == Some(count) {
                return false;
            }
            state.last_change = Some(count);
        }

        if self.port.is_sensitive() {
            return false;
        }
        let content = match self.port.read() {
            Ok(Some(content)) => content,
            Ok(None) => return false,
            Err(error) => {
                tracing::debug!(%error, "no se pudo leer el portapapeles");
                return false;
            }
        };

        let stored = self.state().history.push(content, now_ms).is_some();
        if stored {
            self.events.publish(DomainEvent::ClipboardChanged);
        }
        stored
    }

    /// El historial, lo más reciente primero.
    pub fn list(&self) -> Vec<EntryView> {
        self.state().history.views()
    }

    /// Vuelve a poner un elemento del historial en el portapapeles y lo sube al primer lugar.
    pub fn copy(&self, id: u64) -> Result<(), ClipboardError> {
        self.copy_at(id, now_ms())
    }

    fn copy_at(&self, id: u64, now_ms: u64) -> Result<(), ClipboardError> {
        let mut state = self.state();
        let content = state.history.content_of(id)?;
        self.port.write(&content)?;
        // Lo que acabamos de escribir no debe contarse como una copia nueva del usuario.
        state.last_change = Some(self.port.change_count());
        state.history.touch(id, now_ms);
        drop(state);
        self.events.publish(DomainEvent::ClipboardChanged);
        Ok(())
    }

    /// El texto completo de un elemento del historial (no sube nada ni toca el portapapeles).
    pub fn text_of(&self, id: u64) -> Result<String, ClipboardError> {
        self.state().history.text_of(id)
    }

    /// Pone un texto en el portapapeles (por ejemplo, lo que contestó la IA). El monitor lo verá
    /// como una copia más y lo guardará en el historial.
    pub fn write_text(&self, text: String) -> Result<(), ClipboardError> {
        self.port.write(&Content::Text(text))
    }

    pub fn delete(&self, id: u64) -> bool {
        let removed = self.state().history.remove(id);
        if removed {
            self.events.publish(DomainEvent::ClipboardChanged);
        }
        removed
    }

    pub fn clear(&self) {
        self.state().history.clear();
        self.events.publish(DomainEvent::ClipboardChanged);
    }
}

/// Hilo que vigila el portapapeles mientras la app esté abierta.
pub fn spawn_monitor(service: Arc<ClipboardService>) {
    let spawned = thread::Builder::new()
        .name("orbit-clipboard".into())
        .spawn(move || loop {
            service.poll();
            thread::sleep(POLL_EVERY);
        });
    if let Err(error) = spawned {
        tracing::warn!(%error, "no se pudo iniciar el monitor del portapapeles");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::testing::FakeEventSink;

    #[derive(Default)]
    struct FakeState {
        count: u64,
        content: Option<Content>,
        sensitive: bool,
        read_fails: bool,
        write_fails: bool,
        writes: Vec<Content>,
    }

    /// Portapapeles simulado: el test "copia" cosas con `copy` y mira lo que escribió Orbit.
    #[derive(Default)]
    struct FakeClipboard {
        state: Mutex<FakeState>,
    }

    impl FakeClipboard {
        fn copy(&self, content: Content) {
            let mut state = self.state.lock().unwrap();
            state.count += 1;
            state.content = Some(content);
        }
        fn copy_text(&self, text: &str) {
            self.copy(Content::Text(text.to_string()));
        }
        fn set(&self, change: impl FnOnce(&mut FakeState)) {
            change(&mut self.state.lock().unwrap());
        }
        fn writes(&self) -> Vec<Content> {
            self.state.lock().unwrap().writes.clone()
        }
    }

    struct Shared(Arc<FakeClipboard>);

    impl ClipboardPort for Shared {
        fn change_count(&self) -> u64 {
            self.0.state.lock().unwrap().count
        }
        fn is_sensitive(&self) -> bool {
            self.0.state.lock().unwrap().sensitive
        }
        fn read(&self) -> Result<Option<Content>, ClipboardError> {
            let state = self.0.state.lock().unwrap();
            if state.read_fails {
                return Err(ClipboardError::System("fallo simulado".into()));
            }
            Ok(state.content.clone())
        }
        fn write(&self, content: &Content) -> Result<(), ClipboardError> {
            let mut state = self.0.state.lock().unwrap();
            if state.write_fails {
                return Err(ClipboardError::System("fallo simulado".into()));
            }
            state.count += 1; // escribir también cambia el contador, como en un sistema real
            state.content = Some(content.clone());
            state.writes.push(content.clone());
            Ok(())
        }
    }

    fn setup() -> (ClipboardService, Arc<FakeClipboard>, Arc<FakeEventSink>) {
        let clipboard = Arc::new(FakeClipboard::default());
        let events = Arc::new(FakeEventSink::default());
        let service =
            ClipboardService::new(Box::new(Shared(Arc::clone(&clipboard))), events.clone());
        (service, clipboard, events)
    }

    fn texts(service: &ClipboardService) -> Vec<String> {
        service.list().into_iter().filter_map(|v| v.text).collect()
    }

    fn changed_events(events: &FakeEventSink) -> usize {
        events
            .events()
            .iter()
            .filter(|e| **e == DomainEvent::ClipboardChanged)
            .count()
    }

    fn picture(seed: u8) -> Content {
        let side = 32;
        let rgba = (0..side * side)
            .flat_map(|i| [seed.wrapping_add(i as u8), seed, 7, 255])
            .collect();
        Content::Image(RgbaImage {
            width: side,
            height: side,
            rgba,
        })
    }

    #[test]
    fn what_was_already_copied_when_the_app_opens_enters_the_history() {
        let (service, clipboard, _) = setup();
        clipboard.copy_text("ya estaba copiado");
        assert!(service.poll_at(1));
        assert_eq!(texts(&service), vec!["ya estaba copiado"]);
    }

    #[test]
    fn nothing_changes_while_nothing_is_copied() {
        let (service, clipboard, events) = setup();
        clipboard.copy_text("uno");
        assert!(service.poll_at(1));
        assert!(!service.poll_at(2));
        assert!(!service.poll_at(3));
        assert_eq!(changed_events(&events), 1);
    }

    #[test]
    fn every_new_copy_is_recorded_newest_first() {
        let (service, clipboard, events) = setup();
        for (n, text) in ["primero", "segundo", "tercero"].iter().enumerate() {
            clipboard.copy_text(text);
            assert!(service.poll_at(n as u64));
        }
        assert_eq!(texts(&service), vec!["tercero", "segundo", "primero"]);
        assert_eq!(changed_events(&events), 3);
    }

    #[test]
    fn copying_an_old_text_again_brings_it_back_to_the_top() {
        let (service, clipboard, _) = setup();
        clipboard.copy_text("A");
        service.poll_at(1);
        clipboard.copy_text("B");
        service.poll_at(2);
        clipboard.copy_text("A");
        service.poll_at(3);
        assert_eq!(texts(&service), vec!["A", "B"]);
    }

    #[test]
    fn sensitive_copies_are_never_stored() {
        let (service, clipboard, events) = setup();
        clipboard.set(|s| s.sensitive = true);
        clipboard.copy_text("contraseña-super-secreta");
        assert!(!service.poll_at(1));
        assert!(service.list().is_empty());
        assert_eq!(changed_events(&events), 0);

        // Y vuelve a funcionar con lo siguiente que no sea sensible.
        clipboard.set(|s| s.sensitive = false);
        clipboard.copy_text("normal");
        assert!(service.poll_at(2));
        assert_eq!(texts(&service), vec!["normal"]);
    }

    #[test]
    fn images_are_recorded_with_their_dimensions() {
        let (service, clipboard, _) = setup();
        clipboard.copy(picture(5));
        assert!(service.poll_at(1));
        let view = &service.list()[0];
        assert_eq!(view.kind, history::Kind::Image);
        assert_eq!((view.width, view.height), (Some(32), Some(32)));
        assert!(view.thumbnail.is_some());
    }

    #[test]
    fn unsupported_or_failing_reads_are_skipped_quietly() {
        let (service, clipboard, _) = setup();
        clipboard.set(|s| s.count = 1); // cambió, pero no hay texto ni imagen
        assert!(!service.poll_at(1));

        clipboard.set(|s| {
            s.count = 2;
            s.read_fails = true;
        });
        assert!(!service.poll_at(2));
        assert!(service.list().is_empty());
    }

    #[test]
    fn copying_from_the_history_writes_the_text_and_moves_it_to_the_top() {
        let (service, clipboard, events) = setup();
        clipboard.copy_text("mensaje 1");
        service.poll_at(1);
        clipboard.copy_text("mensaje 2");
        service.poll_at(2);
        let first = service.list().last().unwrap().id;
        let before = changed_events(&events);

        service.copy_at(first, 3).unwrap();

        assert_eq!(clipboard.writes(), vec![Content::Text("mensaje 1".into())]);
        assert_eq!(texts(&service), vec!["mensaje 1", "mensaje 2"]);
        assert_eq!(service.list()[0].copied_at_ms, 3);
        assert_eq!(changed_events(&events), before + 1);

        // El portapapeles ya contiene eso: no se cuenta como una copia nueva ni se duplica.
        assert!(!service.poll_at(4));
        assert_eq!(service.list().len(), 2);
    }

    #[test]
    fn copying_an_image_from_the_history_restores_the_exact_pixels() {
        let (service, clipboard, _) = setup();
        let original = picture(11);
        clipboard.copy(original.clone());
        service.poll_at(1);
        let id = service.list()[0].id;

        service.copy_at(id, 2).unwrap();
        assert_eq!(clipboard.writes(), vec![original]);
    }

    #[test]
    fn writing_a_text_puts_it_in_the_clipboard_and_the_monitor_records_it() {
        let (service, clipboard, _) = setup();

        service.write_text("resultado de la IA".into()).unwrap();

        assert_eq!(
            clipboard.writes(),
            vec![Content::Text("resultado de la IA".into())]
        );
        // Entra al historial como cualquier copia del usuario.
        assert!(service.poll_at(1));
        assert_eq!(texts(&service), vec!["resultado de la IA"]);
    }

    #[test]
    fn the_full_text_of_an_entry_is_available_for_the_ai() {
        let (service, clipboard, _) = setup();
        clipboard.copy_text("texto completo");
        service.poll_at(1);
        clipboard.copy(picture(2));
        service.poll_at(2);

        let list = service.list();
        let image = list
            .iter()
            .find(|e| e.kind == history::Kind::Image)
            .unwrap();
        let text = list.iter().find(|e| e.kind == history::Kind::Text).unwrap();
        assert_eq!(service.text_of(text.id).unwrap(), "texto completo");
        assert!(matches!(
            service.text_of(image.id),
            Err(ClipboardError::NotText)
        ));
    }

    #[test]
    fn copying_something_that_is_gone_is_an_error() {
        let (service, _, _) = setup();
        assert!(matches!(
            service.copy_at(42, 1),
            Err(ClipboardError::NotFound)
        ));
    }

    #[test]
    fn a_failed_write_changes_nothing() {
        let (service, clipboard, _) = setup();
        clipboard.copy_text("uno");
        service.poll_at(1);
        clipboard.copy_text("dos");
        service.poll_at(2);
        let id = service.list().last().unwrap().id;

        clipboard.set(|s| s.write_fails = true);
        assert!(matches!(
            service.copy_at(id, 3),
            Err(ClipboardError::System(_))
        ));
        assert_eq!(texts(&service), vec!["dos", "uno"]); // el orden no se tocó
    }

    #[test]
    fn deleting_one_entry_notifies_and_keeps_the_rest() {
        let (service, clipboard, events) = setup();
        clipboard.copy_text("a");
        service.poll_at(1);
        clipboard.copy_text("b");
        service.poll_at(2);
        let a = service.list().last().unwrap().id;
        let before = changed_events(&events);

        assert!(service.delete(a));
        assert!(!service.delete(a));
        assert_eq!(texts(&service), vec!["b"]);
        assert_eq!(changed_events(&events), before + 1);
    }

    #[test]
    fn clearing_empties_the_history_and_notifies() {
        let (service, clipboard, events) = setup();
        clipboard.copy_text("a");
        service.poll_at(1);
        clipboard.copy_text("b");
        service.poll_at(2);
        let before = changed_events(&events);

        service.clear();
        assert!(service.list().is_empty());
        assert_eq!(changed_events(&events), before + 1);
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(ClipboardError::NotFound.code(), "clipboard.notFound");
        assert_eq!(
            ClipboardError::System("x".into()).code(),
            "clipboard.system"
        );
        assert_eq!(ClipboardError::Image("x".into()).code(), "clipboard.image");
    }
}
