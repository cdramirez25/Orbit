//! Adaptador de las ventanas del escritorio: una ventana de fondo por monitor que tenga fondo
//! (`wallpaper-0`, `wallpaper-1`… según la posición del monitor), colocada detrás de los iconos. Cada
//! una carga `wallpaper.html`, que dibuja la imagen o el video de su monitor y obedece las pausas.

use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Manager};

use super::{platform, screen_keys, ScreenInfo, Surface, WallpaperError};
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
    /// Dónde se puso cada ventana la última vez (por monitor): así `sync` no hace nada si no cambió.
    placed: Mutex<Vec<Option<Rect>>>,
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
    fn screens(&self) -> Result<Vec<ScreenInfo>, WallpaperError> {
        let screens = platform::screens(&self.app)?;
        let names: Vec<Option<String>> = screens.iter().map(|screen| screen.name.clone()).collect();
        Ok(screen_keys(&names)
            .into_iter()
            .zip(screens)
            .map(|(key, screen)| ScreenInfo {
                key,
                label: screen.label,
            })
            .collect())
    }

    fn sync(&self, active: &[bool]) -> Result<(), WallpaperError> {
        let screens = platform::screens(&self.app)?;
        let mut placed = self.placed.lock().unwrap_or_else(PoisonError::into_inner);
        placed.resize(screens.len(), None);

        for (index, screen) in screens.iter().enumerate() {
            let name = label(index);
            let existing = self.app.get_webview_window(&name);
            // Un monitor sin fondo no tiene ventana.
            if !active.get(index).copied().unwrap_or(false) {
                if let Some(window) = existing {
                    let _ = window.destroy();
                }
                placed[index] = None;
                continue;
            }
            if existing.is_some() && placed[index] == Some(screen.rect) {
                continue;
            }
            let window = match existing {
                Some(window) => window,
                None => platform::create_window(&self.app, &name)?,
            };
            platform::place(&self.app, &window, screen.rect)?;
            placed[index] = Some(screen.rect);
        }

        // Un monitor que se desconectó deja su ventana sobrando.
        for (name, window) in self.app.webview_windows() {
            if index_of(&name).is_some_and(|index| index >= screens.len()) {
                let _ = window.destroy();
            }
        }
        Ok(())
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
