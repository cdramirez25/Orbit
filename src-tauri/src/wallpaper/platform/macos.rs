//! macOS: cada ventana de fondo es una `NSWindow` normal puesta al nivel del escritorio (justo encima
//! de la imagen de fondo del sistema y debajo de los iconos), visible en todos los Spaces, sin mouse
//! y fuera del ciclo de ventanas. Las ventanas abiertas se leen con `CGWindowList` (no pide permisos:
//! solo se usan el dueño, la capa y el tamaño, no el título).

use std::path::Path;
use std::process::Command;

use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::window::{
    create_description_from_array, create_window_list, kCGNullWindowID, kCGWindowAlpha,
    kCGWindowBounds, kCGWindowLayer, kCGWindowListExcludeDesktopElements,
    kCGWindowListOptionOnScreenOnly, kCGWindowOwnerPID,
};
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, WebviewWindow, Wry};

use super::on_main_thread;
use crate::wallpaper::WallpaperError;
use crate::window::island_window::Rect;

/// `kCGDesktopWindowLevelKey`: el nivel de la imagen de fondo del escritorio.
const DESKTOP_WINDOW_LEVEL_KEY: i32 = 2;

/// Una ventana con menos opacidad que esto no se ve: no cuenta como abierta.
const MIN_ALPHA: f64 = 0.05;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// El nivel de ventana que corresponde a una de las claves de `CGWindowLevelKey`.
    fn CGWindowLevelForKey(key: i32) -> i32;
}

/// Los monitores en puntos lógicos (el mismo espacio de la isla y de `CGWindowList`).
pub fn screens(app: &AppHandle) -> tauri::Result<Vec<Rect>> {
    Ok(app
        .available_monitors()?
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let position = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            Rect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect())
}

/// Nada que cambiar en la ventana al crearla en macOS.
pub fn customize<'a, M: tauri::Manager<Wry>>(
    builder: WebviewWindowBuilder<'a, Wry, M>,
) -> WebviewWindowBuilder<'a, Wry, M> {
    builder
}

pub fn place(app: &AppHandle, window: &WebviewWindow, frame: Rect) -> Result<(), WallpaperError> {
    let fail = |error: tauri::Error| WallpaperError::Surface(error.to_string());
    // Primero el tamaño y después la posición: en macOS cambiar el tamaño de una ventana mantiene
    // fija su esquina de abajo a la izquierda, así que si no, el borde de arriba se corre.
    window
        .set_size(LogicalSize::new(frame.width, frame.height))
        .map_err(fail)?;
    window
        .set_position(LogicalPosition::new(frame.x, frame.y))
        .map_err(fail)?;

    let target = window.clone();
    on_main_thread(app, move || {
        let Ok(pointer) = target.ns_window() else {
            return;
        };
        // SAFETY: `ns_window` da el `NSWindow` de esta ventana, que sigue viva (`target`), y aquí
        // estamos en el hilo principal.
        let ns_window = unsafe { &*pointer.cast::<NSWindow>() };
        // SAFETY: función de CoreGraphics sin argumentos ni efectos sobre memoria de Rust.
        let level = unsafe { CGWindowLevelForKey(DESKTOP_WINDOW_LEVEL_KEY) } + 1;
        ns_window.setLevel(level as isize);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        ns_window.setIgnoresMouseEvents(true);
        ns_window.setHasShadow(false);
    })?;
    window.show().map_err(fail)
}

pub fn open_folder(path: &Path) -> Result<(), WallpaperError> {
    let status = Command::new("open")
        .arg(path)
        .status()
        .map_err(|error| WallpaperError::OpenFolder(error.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(WallpaperError::OpenFolder(format!(
            "`open` terminó con {status}"
        )))
    }
}

fn number(dictionary: &CFDictionary<CFString, CFType>, key: &'static str) -> Option<f64> {
    let value = dictionary.find(CFString::from_static_string(key))?;
    value.downcast::<CFNumber>()?.to_f64()
}

/// Las ventanas de apps que se ven ahora (capa 0: las normales; la barra de menús, el Dock y la isla
/// están en otras), sin las de Orbit, en puntos lógicos.
pub fn open_windows(_app: &AppHandle) -> Result<Vec<Rect>, WallpaperError> {
    let ids = create_window_list(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )
    .ok_or_else(|| WallpaperError::Surface("no se pudo leer la lista de ventanas".into()))?;
    let descriptions = create_description_from_array(ids)
        .ok_or_else(|| WallpaperError::Surface("no se pudo leer la lista de ventanas".into()))?;

    // SAFETY: son constantes de CoreGraphics que viven todo el programa.
    let (layer, alpha, pid, bounds) = unsafe {
        (
            CFString::wrap_under_get_rule(kCGWindowLayer),
            CFString::wrap_under_get_rule(kCGWindowAlpha),
            CFString::wrap_under_get_rule(kCGWindowOwnerPID),
            CFString::wrap_under_get_rule(kCGWindowBounds),
        )
    };
    let own_pid = f64::from(std::process::id());

    let mut windows = Vec::new();
    for description in descriptions.iter() {
        let read = |key: &CFString| -> Option<f64> {
            description.find(key)?.downcast::<CFNumber>()?.to_f64()
        };
        if read(&layer) != Some(0.0) || read(&pid) == Some(own_pid) {
            continue;
        }
        if read(&alpha).is_some_and(|value| value < MIN_ALPHA) {
            continue;
        }
        let Some(item) = description.find(&bounds) else {
            continue;
        };
        if !item.instance_of::<CFDictionary>() {
            continue;
        }
        // SAFETY: se acaba de comprobar que el valor es un diccionario.
        let rect: CFDictionary<CFString, CFType> =
            unsafe { CFDictionary::wrap_under_get_rule(item.as_CFTypeRef() as CFDictionaryRef) };
        if let (Some(x), Some(y), Some(width), Some(height)) = (
            number(&rect, "X"),
            number(&rect, "Y"),
            number(&rect, "Width"),
            number(&rect, "Height"),
        ) {
            windows.push(Rect {
                x,
                y,
                width,
                height,
            });
        }
    }
    Ok(windows)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lo que macOS dice que hay abierto ahora mismo (sin las ventanas de Orbit). Manual: depende de
    /// lo que tengas abierto.
    ///
    /// ```text
    /// cargo test live_lists_the_open_windows -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "depende de las ventanas que haya abiertas"]
    fn live_lists_the_open_windows() {
        let app_windows = {
            // Sin `AppHandle` en un test: se usa la misma lectura que la app, que no lo necesita.
            let ids = create_window_list(
                kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
                kCGNullWindowID,
            )
            .expect("CGWindowList debe responder");
            ids.len()
        };
        println!("ventanas en pantalla (todas las capas): {app_windows}");
        assert!(app_windows > 0);
    }
}
