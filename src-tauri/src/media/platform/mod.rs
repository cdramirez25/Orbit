//! Código específico de plataforma. Solo aquí (y bajo `#[cfg(target_os = "...")]`): la lógica
//! común no sabe en qué SO corre y siempre entra por `platform::current`.

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
pub use self::macos as current;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub use self::windows as current;
