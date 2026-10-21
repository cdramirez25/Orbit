//! Adaptador del portapapeles real con `arboard` (macOS y Windows). El detector de cambios y la
//! comprobación de contenido sensible son específicos de cada sistema y viven en `platform/`.

use std::borrow::Cow;

use arboard::{Clipboard, Error, ImageData};

use super::image::RgbaImage;
use super::{platform, ClipboardError, ClipboardPort, Content};

pub struct SystemClipboard;

impl SystemClipboard {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SystemClipboard {
    fn default() -> Self {
        Self::new()
    }
}

fn system_error(error: impl std::fmt::Display) -> ClipboardError {
    ClipboardError::System(error.to_string())
}

impl ClipboardPort for SystemClipboard {
    fn change_count(&self) -> u64 {
        platform::current::change_count()
    }

    fn is_sensitive(&self) -> bool {
        platform::current::is_sensitive()
    }

    fn read(&self) -> Result<Option<Content>, ClipboardError> {
        // Se crea un `Clipboard` por operación: es barato y evita compartir estado entre hilos.
        let mut clipboard = Clipboard::new().map_err(system_error)?;

        // El texto va primero: al copiar celdas o texto con formato, el sistema suele ofrecer
        // también una imagen, y lo que el usuario quiere es el texto.
        match clipboard.get_text() {
            Ok(text) if !text.trim().is_empty() => return Ok(Some(Content::Text(text))),
            Ok(_) | Err(Error::ContentNotAvailable) => {}
            Err(error) => return Err(system_error(error)),
        }

        match clipboard.get_image() {
            Ok(image) => Ok(Some(Content::Image(RgbaImage {
                width: image.width,
                height: image.height,
                rgba: image.bytes.into_owned(),
            }))),
            // Archivos u otros formatos que no sabemos mostrar: no se guardan.
            Err(_) => Ok(None),
        }
    }

    fn write(&self, content: &Content) -> Result<(), ClipboardError> {
        let mut clipboard = Clipboard::new().map_err(system_error)?;
        match content {
            Content::Text(text) => clipboard.set_text(text.as_str()).map_err(system_error),
            Content::Image(image) => clipboard
                .set_image(ImageData {
                    width: image.width,
                    height: image.height,
                    bytes: Cow::Borrowed(&image.rgba),
                })
                .map_err(system_error),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::clipboard::history::Kind;
    use crate::clipboard::ClipboardService;
    use crate::events::testing::FakeEventSink;

    /// Toca el portapapeles real del sistema, por eso no corre con el resto:
    /// `cargo test live_clipboard -- --ignored`. Deja el portapapeles vacío al terminar.
    #[test]
    #[ignore = "usa el portapapeles real del sistema"]
    fn live_clipboard_round_trip_through_the_service() {
        let port = SystemClipboard::new();
        let service = ClipboardService::new(
            Box::new(SystemClipboard::new()),
            Arc::new(FakeEventSink::default()),
        );
        service.poll(); // lo que hubiera de antes
        let baseline = service.list().len();
        eprintln!("baseline entries: {baseline}");

        // Otra app copia un texto.
        port.write(&Content::Text("orbit live test".into()))
            .expect("write text");
        assert!(service.poll());
        let first = service.list().remove(0);
        assert_eq!(first.kind, Kind::Text);
        assert_eq!(first.text.as_deref(), Some("orbit live test"));
        assert!(!port.is_sensitive());

        // Y luego una imagen.
        let rgba = [[255, 0, 0, 255], [0, 255, 0, 255]].concat();
        port.write(&Content::Image(RgbaImage {
            width: 2,
            height: 1,
            rgba,
        }))
        .expect("write image");
        assert!(service.poll());
        let second = service.list().remove(0);
        assert_eq!(second.kind, Kind::Image);
        assert_eq!((second.width, second.height), (Some(2), Some(1)));
        assert!(second.thumbnail.is_some());

        // Volver a copiar el texto lo pone otra vez en el sistema y lo sube al primer lugar.
        service.copy(first.id).expect("copy");
        assert!(matches!(
            port.read().expect("read"),
            Some(Content::Text(text)) if text == "orbit live test"
        ));
        assert_eq!(service.list().len(), baseline + 2);
        assert_eq!(service.list()[0].id, first.id);

        Clipboard::new()
            .and_then(|mut clipboard| clipboard.clear())
            .expect("clear");
    }
}
