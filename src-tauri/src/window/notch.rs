//! Detección del notch. El tipo y el cálculo son comunes; la lectura de `NSScreen` vive en
//! `platform/macos.rs`.

use serde::Serialize;
use tauri::AppHandle;

use super::platform;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Espejo de `NotchInfo` en `src/types/island.ts`. Medidas en puntos lógicos.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchInfo {
    pub has_notch: bool,
    pub notch_width: f64,
    pub notch_height: f64,
    pub screen_frame: ScreenFrame,
}

impl NotchInfo {
    pub fn none(screen_frame: ScreenFrame) -> Self {
        Self {
            has_notch: false,
            notch_width: 0.0,
            notch_height: 0.0,
            screen_frame,
        }
    }
}

/// Calcula el notch a partir de lo que reporta `NSScreen`: la altura es el inset superior del
/// área segura y el ancho es lo que queda entre las dos áreas auxiliares de la barra de menús.
pub fn notch_from_metrics(
    screen_frame: ScreenFrame,
    safe_area_top: f64,
    aux_left_width: f64,
    aux_right_width: f64,
) -> NotchInfo {
    let notch_width = screen_frame.width - aux_left_width - aux_right_width;
    let has_notch =
        safe_area_top > 0.0 && aux_left_width > 0.0 && aux_right_width > 0.0 && notch_width > 0.0;

    if !has_notch {
        return NotchInfo::none(screen_frame);
    }

    NotchInfo {
        has_notch,
        notch_width,
        notch_height: safe_area_top,
        screen_frame,
    }
}

/// Notch de la pantalla donde está la isla (sin notch en Windows y Macs sin notch).
pub fn detect(app: &AppHandle) -> NotchInfo {
    platform::current::notch_info(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAME: ScreenFrame = ScreenFrame {
        x: 0.0,
        y: 0.0,
        width: 1512.0,
        height: 982.0,
    };

    #[test]
    fn macbook_with_notch() {
        // MacBook Pro 14": áreas auxiliares de 661 pt a cada lado → notch de 190 pt.
        let info = notch_from_metrics(FRAME, 32.0, 661.0, 661.0);
        assert!(info.has_notch);
        assert_eq!(info.notch_width, 190.0);
        assert_eq!(info.notch_height, 32.0);
    }

    #[test]
    fn display_without_notch() {
        assert_eq!(
            notch_from_metrics(FRAME, 0.0, 0.0, 0.0),
            NotchInfo::none(FRAME)
        );
    }

    #[test]
    fn inconsistent_metrics_are_treated_as_no_notch() {
        // Áreas que suman más que la pantalla → ancho negativo.
        assert!(!notch_from_metrics(FRAME, 32.0, 900.0, 900.0).has_notch);
        // Inset sin áreas auxiliares.
        assert!(!notch_from_metrics(FRAME, 32.0, 0.0, 0.0).has_notch);
    }
}
