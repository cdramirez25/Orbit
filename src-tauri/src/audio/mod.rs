//! Audio del sistema: lo que suena por bocinas y audífonos (nunca el micrófono). Aquí viven los
//! puertos y los tipos de dominio; las implementaciones por sistema operativo, en `platform/`.
//!
//! Fase 2: de momento solo el permiso para poder capturar. La captura (`AudioSource`), el
//! remuestreo y el medidor de nivel llegan a continuación.

pub mod permission;
pub mod platform;

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("no se pudieron abrir los ajustes del sistema: {0}")]
    OpenSettings(#[from] std::io::Error),
}
