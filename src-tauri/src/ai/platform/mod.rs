//! Código específico de plataforma: el llavero del sistema. Solo aquí (y bajo
//! `#[cfg(target_os = "...")]`): el resto entra por `platform::current`.

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub mod keychain;
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use self::keychain as current;
