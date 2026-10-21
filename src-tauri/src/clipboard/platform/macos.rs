//! macOS: `NSPasteboard` lleva un contador (`changeCount`) que sube cada vez que se copia algo, así
//! que basta con consultarlo; el contenido solo se lee cuando cambia.

use objc2_app_kit::NSPasteboard;

/// Tipos con los que los gestores de contraseñas y otras apps marcan lo que NO debe guardarse en
/// un historial (convención de <http://nspasteboard.org>).
const SENSITIVE_TYPES: [&str; 2] = [
    "org.nspasteboard.ConcealedType",
    "org.nspasteboard.TransientType",
];

pub fn change_count() -> u64 {
    u64::try_from(NSPasteboard::generalPasteboard().changeCount()).unwrap_or(0)
}

/// ¿Lo copiado está marcado como oculto o temporal?
pub fn is_sensitive() -> bool {
    let pasteboard = NSPasteboard::generalPasteboard();
    let Some(types) = pasteboard.types() else {
        return false;
    };
    types
        .iter()
        .any(|kind| SENSITIVE_TYPES.contains(&kind.to_string().as_str()))
}
