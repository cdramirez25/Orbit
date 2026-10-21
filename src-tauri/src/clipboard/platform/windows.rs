//! Windows: `GetClipboardSequenceNumber` sube cada vez que cambia el portapapeles (no hace falta
//! abrirlo). Verificar a mano en Windows 10 / 11.

use windows::core::w;
use windows::Win32::System::DataExchange::{
    GetClipboardSequenceNumber, IsClipboardFormatAvailable, RegisterClipboardFormatW,
};

pub fn change_count() -> u64 {
    // SAFETY: función de Win32 sin argumentos.
    u64::from(unsafe { GetClipboardSequenceNumber() })
}

/// ¿Lo copiado lleva alguna de las marcas con las que los gestores de contraseñas piden que el
/// contenido no se guarde en historiales?
pub fn is_sensitive() -> bool {
    let formats = [
        w!("ExcludeClipboardContentFromMonitorProcessing"),
        w!("Clipboard Viewer Ignore"),
    ];
    formats.iter().any(|name| {
        // SAFETY: `name` es una cadena UTF-16 terminada en cero con vida 'static.
        let id = unsafe { RegisterClipboardFormatW(*name) };
        // SAFETY: consulta de solo lectura de un formato registrado.
        id != 0 && unsafe { IsClipboardFormatAvailable(id) }.is_ok()
    })
}
