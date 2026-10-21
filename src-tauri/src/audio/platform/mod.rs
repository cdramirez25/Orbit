//! Código específico de plataforma. Solo aquí (y bajo `#[cfg(target_os = "...")]`): la lógica
//! común no sabe en qué SO corre y siempre entra por `platform::current`.

#[cfg(target_os = "macos")]
pub mod macos_sck;
#[cfg(target_os = "macos")]
pub use self::macos_sck as current;

#[cfg(target_os = "windows")]
pub mod windows_wasapi;
#[cfg(target_os = "windows")]
pub use self::windows_wasapi as current;
