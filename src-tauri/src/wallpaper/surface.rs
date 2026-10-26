//! Adaptador de las ventanas del escritorio: una ventana de fondo (`wallpaper-0`, `wallpaper-1`…) por
//! monitor, colocada detrás de los iconos. Cada una carga `wallpaper.html`, que dibuja la imagen o el
//! video elegido y obedece las pausas.

use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Manager};

use super::{platform, Surface, WallpaperError};
use crate::window::island_window::Rect;

/// Prefijo de las etiquetas de las ventanas de fondo (los permisos de Tauri lo usan: `wallpaper-*`).
pub const LABEL_PREFIX: &str = "wallpaper-";

fn label(index: usize) -> String {
    format!("{LABEL_PREFIX}{index}")
}

fn index_of(label: &str) -> Option<usize> {
    label.strip_prefix(LABEL_PREFIX)?.parse().ok()
}

pub struct TauriSurface {
    app: AppHandle,
    /// Dónde se puso cada ventana la última vez: así `sync` no hace nada si no cambió el monitor.
    placed: Mutex<Vec<Rect>>,
}

impl TauriSurface {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            placed: Mutex::new(Vec::new()),
        }
    }
}

impl Surface for TauriSurface {
    fn sync(&self) -> Result<usize, WallpaperError> {
        let screens = platform::screens(&self.app)?;
        let mut placed = self.placed.lock().unwrap_or_else(PoisonError::into_inner);

        for (index, frame) in screens.iter().enumerate() {
            let name = label(index);
            let existing = self.app.get_webview_window(&name);
            if existing.is_some() && placed.get(index) == Some(frame) {
                continue;
            }
            let window = match existing {
                Some(window) => window,
                None => platform::create_window(&self.app, &name)?,
            };
            platform::place(&self.app, &window, *frame)?;
        }

        // Un monitor que se desconectó deja su ventana sobrando.
        for (name, window) in self.app.webview_windows() {
            if index_of(&name).is_some_and(|index| index >= screens.len()) {
                let _ = window.destroy();
            }
        }
        let count = screens.len();
        *placed = screens;
        Ok(count)
    }

    fn hide(&self) {
        for (name, window) in self.app.webview_windows() {
            if index_of(&name).is_some() {
                let _ = window.destroy();
            }
        }
        self.placed
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_labels_round_trip() {
        assert_eq!(label(0), "wallpaper-0");
        assert_eq!(label(12), "wallpaper-12");
        assert_eq!(index_of("wallpaper-3"), Some(3));
        assert_eq!(index_of("wallpaper-"), None);
        assert_eq!(index_of("wallpaper-x"), None);
        assert_eq!(index_of("island"), None);
        assert_eq!(index_of("settings"), None);
    }
}
