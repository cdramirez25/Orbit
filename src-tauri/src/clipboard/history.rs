//! Historial del portapapeles: solo en memoria (se pierde al cerrar la app), con límites y sin
//! duplicados. Lo más reciente va primero.

use std::collections::VecDeque;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;

#[cfg(test)]
use super::image::RgbaImage;
use super::image::{decode_png, encode_png, thumbnail};
use super::{ClipboardError, Content};

/// Cuántos elementos se guardan como máximo.
pub const MAX_ENTRIES: usize = 100;
/// Un texto más largo que esto no se guarda (protege la memoria).
pub const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
/// Memoria máxima de todo el historial; al pasarse se descarta lo más antiguo.
pub const MAX_TOTAL_BYTES: usize = 200 * 1024 * 1024;
/// Lado mayor de las miniaturas que se envían a la interfaz.
const THUMBNAIL_SIDE: usize = 160;
/// Caracteres del texto que se envían a la interfaz como vista previa.
const PREVIEW_CHARS: usize = 400;

struct StoredImage {
    width: usize,
    height: usize,
    /// La imagen completa en PNG (para volver a copiarla).
    png: Vec<u8>,
    thumbnail_png: Vec<u8>,
    fingerprint: u64,
}

enum Item {
    Text(String),
    Image(StoredImage),
}

impl Item {
    fn size(&self) -> usize {
        match self {
            Self::Text(text) => text.len(),
            Self::Image(image) => image.png.len() + image.thumbnail_png.len(),
        }
    }
}

struct Entry {
    id: u64,
    copied_at_ms: u64,
    item: Item,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Text,
    Image,
}

/// Lo que ve la interfaz de cada elemento.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    pub id: u64,
    pub kind: Kind,
    pub copied_at_ms: u64,
    /// Texto: los primeros caracteres.
    pub text: Option<String>,
    /// Texto: cuántos caracteres tiene en total.
    pub char_count: Option<usize>,
    pub width: Option<usize>,
    pub height: Option<usize>,
    /// Imagen: miniatura como `data:image/png;base64,…`.
    pub thumbnail: Option<String>,
}

pub struct History {
    entries: VecDeque<Entry>,
    next_id: u64,
    total_bytes: usize,
    max_entries: usize,
    max_total_bytes: usize,
}

impl Default for History {
    fn default() -> Self {
        Self::with_limits(MAX_ENTRIES, MAX_TOTAL_BYTES)
    }
}

impl History {
    pub fn with_limits(max_entries: usize, max_total_bytes: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            next_id: 1,
            total_bytes: 0,
            max_entries,
            max_total_bytes,
        }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Añade lo copiado. Devuelve el id del elemento (el nuevo, o el que ya existía y sube al
    /// primer lugar) o `None` si no se guarda (vacío, demasiado grande o imagen inválida).
    pub fn push(&mut self, content: Content, now_ms: u64) -> Option<u64> {
        match content {
            Content::Text(text) => {
                if text.trim().is_empty() || text.len() > MAX_TEXT_BYTES {
                    return None;
                }
                let existing = self
                    .entries
                    .iter()
                    .position(|entry| matches!(&entry.item, Item::Text(t) if *t == text));
                match existing {
                    Some(position) => Some(self.bring_to_front(position, now_ms)),
                    None => Some(self.insert(Item::Text(text), now_ms)),
                }
            }
            Content::Image(image) => {
                if !image.is_valid() {
                    return None;
                }
                let fingerprint = image.fingerprint();
                let existing = self.entries.iter().position(|entry| {
                    matches!(&entry.item, Item::Image(i)
                        if i.fingerprint == fingerprint
                            && i.width == image.width
                            && i.height == image.height)
                });
                if let Some(position) = existing {
                    return Some(self.bring_to_front(position, now_ms));
                }
                let png = encode_png(&image).ok()?;
                let thumbnail_png = encode_png(&thumbnail(&image, THUMBNAIL_SIDE)).ok()?;
                Some(self.insert(
                    Item::Image(StoredImage {
                        width: image.width,
                        height: image.height,
                        png,
                        thumbnail_png,
                        fingerprint,
                    }),
                    now_ms,
                ))
            }
        }
    }

    /// El contenido guardado de un elemento, listo para volver a copiarlo.
    pub fn content_of(&self, id: u64) -> Result<Content, ClipboardError> {
        let entry = self
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or(ClipboardError::NotFound)?;
        match &entry.item {
            Item::Text(text) => Ok(Content::Text(text.clone())),
            Item::Image(image) => decode_png(&image.png)
                .map(Content::Image)
                .map_err(ClipboardError::Image),
        }
    }

    /// Sube un elemento al primer lugar (por ejemplo, al volver a copiarlo desde el historial).
    pub fn touch(&mut self, id: u64, now_ms: u64) -> bool {
        match self.entries.iter().position(|entry| entry.id == id) {
            Some(position) => {
                self.bring_to_front(position, now_ms);
                true
            }
            None => false,
        }
    }

    pub fn remove(&mut self, id: u64) -> bool {
        match self.entries.iter().position(|entry| entry.id == id) {
            Some(position) => {
                if let Some(entry) = self.entries.remove(position) {
                    self.total_bytes -= entry.item.size();
                }
                true
            }
            None => false,
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.total_bytes = 0;
    }

    pub fn views(&self) -> Vec<EntryView> {
        self.entries.iter().map(view_of).collect()
    }

    fn insert(&mut self, item: Item, now_ms: u64) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.total_bytes += item.size();
        self.entries.push_front(Entry {
            id,
            copied_at_ms: now_ms,
            item,
        });
        self.enforce_limits();
        id
    }

    fn bring_to_front(&mut self, position: usize, now_ms: u64) -> u64 {
        // `position` viene de una búsqueda previa, así que siempre existe.
        let Some(mut entry) = self.entries.remove(position) else {
            return 0;
        };
        entry.copied_at_ms = now_ms;
        let id = entry.id;
        self.entries.push_front(entry);
        id
    }

    /// Descarta lo más antiguo mientras se pase de elementos o de memoria (siempre queda el último).
    fn enforce_limits(&mut self) {
        while self.entries.len() > 1
            && (self.entries.len() > self.max_entries || self.total_bytes > self.max_total_bytes)
        {
            if let Some(oldest) = self.entries.pop_back() {
                self.total_bytes -= oldest.item.size();
            }
        }
    }
}

fn view_of(entry: &Entry) -> EntryView {
    match &entry.item {
        Item::Text(text) => EntryView {
            id: entry.id,
            kind: Kind::Text,
            copied_at_ms: entry.copied_at_ms,
            text: Some(text.chars().take(PREVIEW_CHARS).collect()),
            char_count: Some(text.chars().count()),
            width: None,
            height: None,
            thumbnail: None,
        },
        Item::Image(image) => EntryView {
            id: entry.id,
            kind: Kind::Image,
            copied_at_ms: entry.copied_at_ms,
            text: None,
            char_count: None,
            width: Some(image.width),
            height: Some(image.height),
            thumbnail: Some(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(&image.thumbnail_png)
            )),
        },
    }
}

/// Imagen decodificada de un elemento (para tests y para volver a copiar).
#[cfg(test)]
pub fn image_of(history: &History, id: u64) -> Option<RgbaImage> {
    match history.content_of(id) {
        Ok(Content::Image(image)) => Some(image),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(value: &str) -> Content {
        Content::Text(value.to_string())
    }

    fn picture(seed: u8, side: usize) -> Content {
        let mut rgba = Vec::with_capacity(side * side * 4);
        for i in 0..side * side {
            rgba.extend([seed.wrapping_add(i as u8), seed, (i / side) as u8, 255]);
        }
        Content::Image(RgbaImage {
            width: side,
            height: side,
            rgba,
        })
    }

    #[test]
    fn newest_comes_first() {
        let mut history = History::default();
        history.push(text("uno"), 1);
        history.push(text("dos"), 2);
        history.push(text("tres"), 3);
        let texts: Vec<_> = history.views().into_iter().filter_map(|v| v.text).collect();
        assert_eq!(texts, vec!["tres", "dos", "uno"]);
    }

    #[test]
    fn copying_the_same_text_again_moves_it_to_the_top_without_duplicating() {
        let mut history = History::default();
        let first = history.push(text("mensaje A"), 1).unwrap();
        history.push(text("mensaje B"), 2);
        let again = history.push(text("mensaje A"), 3).unwrap();

        assert_eq!(first, again);
        assert_eq!(history.len(), 2);
        let views = history.views();
        assert_eq!(views[0].text.as_deref(), Some("mensaje A"));
        assert_eq!(views[0].copied_at_ms, 3);
        assert_eq!(views[1].text.as_deref(), Some("mensaje B"));
    }

    #[test]
    fn blank_and_oversized_texts_are_ignored() {
        let mut history = History::default();
        assert_eq!(history.push(text(""), 1), None);
        assert_eq!(history.push(text("   \n\t "), 1), None);
        assert_eq!(
            history.push(Content::Text("x".repeat(MAX_TEXT_BYTES + 1)), 1),
            None
        );
        assert_eq!(history.len(), 0);
        assert!(history
            .push(Content::Text("x".repeat(MAX_TEXT_BYTES)), 1)
            .is_some());
    }

    #[test]
    fn text_previews_are_truncated_but_report_the_full_length() {
        let mut history = History::default();
        history.push(Content::Text("ñ".repeat(1000)), 1);
        let view = &history.views()[0];
        assert_eq!(view.kind, Kind::Text);
        assert_eq!(
            view.text.as_ref().map(|t| t.chars().count()),
            Some(PREVIEW_CHARS)
        );
        assert_eq!(view.char_count, Some(1000));
    }

    #[test]
    fn images_get_a_thumbnail_and_their_dimensions() {
        let mut history = History::default();
        history.push(picture(7, 400), 5);
        let view = &history.views()[0];
        assert_eq!(view.kind, Kind::Image);
        assert_eq!((view.width, view.height), (Some(400), Some(400)));
        let data_url = view.thumbnail.as_deref().unwrap();
        let encoded = data_url
            .strip_prefix("data:image/png;base64,")
            .expect("es una URL de datos PNG");

        // La miniatura es una imagen más pequeña (lado mayor ≤ 160 px), no la original.
        let png = STANDARD.decode(encoded).unwrap();
        let thumb = decode_png(&png).unwrap();
        assert_eq!(
            (thumb.width, thumb.height),
            (THUMBNAIL_SIDE, THUMBNAIL_SIDE)
        );
        assert_eq!(view.text, None);
    }

    #[test]
    fn the_same_image_is_not_stored_twice() {
        let mut history = History::default();
        let first = history.push(picture(1, 50), 1).unwrap();
        history.push(text("otra cosa"), 2);
        let again = history.push(picture(1, 50), 3).unwrap();
        assert_eq!(first, again);
        assert_eq!(history.len(), 2);
        assert_eq!(history.views()[0].kind, Kind::Image);

        // Una imagen distinta sí se guarda.
        history.push(picture(2, 50), 4);
        assert_eq!(history.len(), 3);
    }

    #[test]
    fn invalid_images_are_ignored() {
        let mut history = History::default();
        let broken = Content::Image(RgbaImage {
            width: 4,
            height: 4,
            rgba: vec![0; 7],
        });
        assert_eq!(history.push(broken, 1), None);
    }

    #[test]
    fn the_stored_image_comes_back_pixel_perfect() {
        let mut history = History::default();
        let Content::Image(original) = picture(9, 64) else {
            unreachable!()
        };
        let id = history.push(Content::Image(original.clone()), 1).unwrap();
        assert_eq!(image_of(&history, id), Some(original));
    }

    #[test]
    fn content_of_returns_text_and_reports_missing_ids() {
        let mut history = History::default();
        let id = history.push(text("hola"), 1).unwrap();
        assert!(matches!(history.content_of(id), Ok(Content::Text(t)) if t == "hola"));
        assert!(matches!(
            history.content_of(999),
            Err(ClipboardError::NotFound)
        ));
    }

    #[test]
    fn the_oldest_entries_are_dropped_past_the_entry_limit() {
        let mut history = History::with_limits(3, MAX_TOTAL_BYTES);
        for n in 0..5 {
            history.push(Content::Text(format!("texto {n}")), n);
        }
        let texts: Vec<_> = history.views().into_iter().filter_map(|v| v.text).collect();
        assert_eq!(texts, vec!["texto 4", "texto 3", "texto 2"]);
    }

    #[test]
    fn the_oldest_entries_are_dropped_past_the_memory_limit() {
        let mut history = History::with_limits(MAX_ENTRIES, 25);
        history.push(Content::Text("a".repeat(10)), 1);
        history.push(Content::Text("b".repeat(10)), 2);
        history.push(Content::Text("c".repeat(10)), 3); // 30 B > 25 B: sale la más antigua
        let texts: Vec<_> = history.views().into_iter().filter_map(|v| v.text).collect();
        assert_eq!(texts, vec!["c".repeat(10), "b".repeat(10)]);
    }

    #[test]
    fn a_single_entry_over_the_memory_limit_is_still_kept() {
        let mut history = History::with_limits(MAX_ENTRIES, 5);
        assert!(history.push(Content::Text("x".repeat(20)), 1).is_some());
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn remove_and_clear_free_the_memory_accounting() {
        let mut history = History::with_limits(MAX_ENTRIES, 25);
        let a = history.push(Content::Text("a".repeat(10)), 1).unwrap();
        history.push(Content::Text("b".repeat(10)), 2);
        assert!(history.remove(a));
        assert!(!history.remove(a));
        // Tras borrar, caben dos más de 10 B sin expulsar nada.
        history.push(Content::Text("c".repeat(10)), 3);
        assert_eq!(history.len(), 2);

        history.clear();
        assert_eq!(history.len(), 0);
        history.push(Content::Text("d".repeat(20)), 4);
        history.push(Content::Text("e".repeat(4)), 5);
        assert_eq!(history.len(), 2); // 24 B ≤ 25 B: la memoria contada empezó de cero
    }

    #[test]
    fn touch_moves_an_entry_to_the_top() {
        let mut history = History::default();
        let first = history.push(text("viejo"), 1).unwrap();
        history.push(text("nuevo"), 2);
        assert!(history.touch(first, 9));
        assert_eq!(history.views()[0].text.as_deref(), Some("viejo"));
        assert_eq!(history.views()[0].copied_at_ms, 9);
        assert!(!history.touch(12345, 10));
    }

    #[test]
    fn ids_are_never_reused() {
        let mut history = History::default();
        let a = history.push(text("a"), 1).unwrap();
        history.remove(a);
        let b = history.push(text("b"), 2).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn the_wire_format_matches_the_frontend() {
        let mut history = History::default();
        history.push(text("hola"), 7);
        let json = serde_json::to_value(history.views()).unwrap();
        assert_eq!(json[0]["kind"], "text");
        assert_eq!(json[0]["copiedAtMs"], 7);
        assert_eq!(json[0]["charCount"], 4);
        assert!(json[0]["thumbnail"].is_null());

        history.push(picture(3, 20), 8);
        let json = serde_json::to_value(history.views()).unwrap();
        assert_eq!(json[0]["kind"], "image");
        assert_eq!(json[0]["width"], 20);
        assert!(json[0]["text"].is_null());
    }
}
