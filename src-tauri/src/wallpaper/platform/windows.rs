//! Windows 10 y 11: cada ventana de fondo se mete como hija de la ventana del escritorio que queda
//! detrás de los iconos (`WorkerW`), igual que hacen Wallpaper Engine y Lively. Es un truco no
//! oficial del escritorio de Windows; si no se encuentra esa ventana (cambió entre versiones) se
//! intenta con el propio `Progman`. Las ventanas abiertas se leen con `EnumWindows`. Verificar a
//! mano en un Windows real.

use std::ffi::c_void;
use std::path::Path;
use std::process::Command;

use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, PhysicalPosition, PhysicalSize, WebviewWindow, Wry};
use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, GetWindowLongPtrW, GetWindowRect,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SendMessageTimeoutW, SetParent,
    SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, SMTO_NORMAL, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW, WS_CHILD, WS_EX_TOOLWINDOW, WS_VISIBLE,
};

use super::on_main_thread;
use crate::wallpaper::WallpaperError;
use crate::window::island_window::Rect;

/// Mensaje no documentado que le pide a `Progman` que cree la ventana `WorkerW` de detrás de los
/// iconos.
const SPAWN_WORKERW: u32 = 0x052C;

/// Clases de ventana del propio escritorio y la barra de tareas: no son "ventanas abiertas".
const SHELL_CLASSES: [&str; 6] = [
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "Windows.UI.Core.CoreWindow",
    "XamlExplorerHostIslandWindow",
];

/// Los monitores en píxeles físicos (el mismo espacio de `GetWindowRect`).
pub fn screens(app: &AppHandle) -> tauri::Result<Vec<Rect>> {
    Ok(app
        .available_monitors()?
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            Rect {
                x: f64::from(position.x),
                y: f64::from(position.y),
                width: f64::from(size.width),
                height: f64::from(size.height),
            }
        })
        .collect())
}

/// Sin foco ni activación, para que nunca le robe el teclado a nada.
pub fn customize<'a, M: tauri::Manager<Wry>>(
    builder: WebviewWindowBuilder<'a, Wry, M>,
) -> WebviewWindowBuilder<'a, Wry, M> {
    builder.focusable(false)
}

pub fn place(app: &AppHandle, window: &WebviewWindow, frame: Rect) -> Result<(), WallpaperError> {
    let fail = |error: tauri::Error| WallpaperError::Surface(error.to_string());
    window
        .set_position(PhysicalPosition::new(frame.x as i32, frame.y as i32))
        .map_err(fail)?;
    window
        .set_size(PhysicalSize::new(frame.width as u32, frame.height as u32))
        .map_err(fail)?;

    let raw = window.hwnd().map_err(fail)?.0 as isize;
    on_main_thread(app, move || {
        // SAFETY: `raw` es el HWND de una ventana de esta app que sigue viva; aquí estamos en el
        // hilo principal, el que la creó.
        unsafe { attach_to_desktop(HWND(raw as *mut c_void), frame) };
    })?;
    window.show().map_err(fail)
}

/// Esta función de enumeración recibe en `lparam` un puntero a donde guardar el `WorkerW` hallado.
unsafe extern "system" fn find_workerw(top: HWND, lparam: LPARAM) -> BOOL {
    // La ventana que contiene los iconos (`SHELLDLL_DefView`) tiene, justo después, la `WorkerW`
    // que queda por detrás de ellos.
    if FindWindowExW(Some(top), None, w!("SHELLDLL_DefView"), PCWSTR::null()).is_ok() {
        if let Ok(workerw) = FindWindowExW(None, Some(top), w!("WorkerW"), PCWSTR::null()) {
            *(lparam.0 as *mut HWND) = workerw;
        }
    }
    BOOL(1)
}

/// Convierte la ventana en hija del escritorio, detrás de los iconos, y la coloca en `frame`.
///
/// # Safety
/// `hwnd` tiene que ser una ventana válida de esta app, y hay que llamarla desde su hilo.
unsafe fn attach_to_desktop(hwnd: HWND, frame: Rect) {
    let Ok(progman) = FindWindowW(w!("Progman"), PCWSTR::null()) else {
        return;
    };
    let mut ignored = 0_usize;
    let _ = SendMessageTimeoutW(
        progman,
        SPAWN_WORKERW,
        WPARAM(0xD),
        LPARAM(0x1),
        SMTO_NORMAL,
        1000,
        Some(&mut ignored),
    );

    let mut workerw = HWND::default();
    let _ = EnumWindows(
        Some(find_workerw),
        LPARAM(&mut workerw as *mut HWND as isize),
    );
    if workerw.0.is_null() {
        // Windows 11 reciente: la `WorkerW` de detrás de los iconos cuelga del propio `Progman`.
        workerw =
            FindWindowExW(Some(progman), None, w!("WorkerW"), PCWSTR::null()).unwrap_or(progman);
    }

    let _ = SetParent(hwnd, Some(workerw));
    let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    SetWindowLongPtrW(
        hwnd,
        GWL_STYLE,
        (style | WS_CHILD.0 as isize | WS_VISIBLE.0 as isize) & !(0x8000_0000_u32 as isize),
    );

    // Las coordenadas de un hijo son relativas a su padre, que cubre todos los monitores.
    let mut origin = POINT {
        x: frame.x as i32,
        y: frame.y as i32,
    };
    let _ = ScreenToClient(workerw, &mut origin);
    let _ = SetWindowPos(
        hwnd,
        None,
        origin.x,
        origin.y,
        frame.width as i32,
        frame.height as i32,
        SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
    );
}

pub fn open_folder(path: &Path) -> Result<(), WallpaperError> {
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| WallpaperError::OpenFolder(error.to_string()))
}

struct Collected {
    own_pid: u32,
    windows: Vec<Rect>,
}

fn class_name(hwnd: HWND) -> String {
    let mut buffer = [0_u16; 128];
    // SAFETY: el búfer es nuestro y `GetClassNameW` no escribe más de su tamaño.
    let length = unsafe { GetClassNameW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..usize::try_from(length).unwrap_or(0)])
}

unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let collected = &mut *(lparam.0 as *mut Collected);

    if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
        return BOOL(1);
    }
    // Las ventanas de herramientas (paletas, avisos) no cuentan como ventanas abiertas.
    if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW.0 as isize != 0 {
        return BOOL(1);
    }
    // Windows 10/11 deja "ocultas" (cloaked) las ventanas de otros escritorios virtuales y las de
    // apps suspendidas: no se ven.
    let mut cloaked = 0_u32;
    if DwmGetWindowAttribute(
        hwnd,
        DWMWA_CLOAKED,
        &mut cloaked as *mut u32 as *mut c_void,
        std::mem::size_of::<u32>() as u32,
    )
    .is_ok()
        && cloaked != 0
    {
        return BOOL(1);
    }
    let mut process = 0_u32;
    GetWindowThreadProcessId(hwnd, Some(&mut process));
    if process == collected.own_pid || SHELL_CLASSES.contains(&class_name(hwnd).as_str()) {
        return BOOL(1);
    }
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_ok() {
        collected.windows.push(Rect {
            x: f64::from(rect.left),
            y: f64::from(rect.top),
            width: f64::from(rect.right - rect.left),
            height: f64::from(rect.bottom - rect.top),
        });
    }
    BOOL(1)
}

/// Las ventanas de apps que se ven ahora, sin las de Orbit, en píxeles físicos.
pub fn open_windows(_app: &AppHandle) -> Result<Vec<Rect>, WallpaperError> {
    let mut collected = Collected {
        // SAFETY: función de Win32 sin argumentos.
        own_pid: unsafe { GetCurrentProcessId() },
        windows: Vec::new(),
    };
    // SAFETY: `collected` vive hasta que `EnumWindows` termina; la función de enumeración solo lo usa
    // durante la llamada.
    unsafe {
        EnumWindows(
            Some(collect_window),
            LPARAM(&mut collected as *mut Collected as isize),
        )
    }
    .map_err(|error| WallpaperError::Surface(error.to_string()))?;
    Ok(collected.windows)
}
