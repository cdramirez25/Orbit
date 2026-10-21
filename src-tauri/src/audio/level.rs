//! Volumen del audio para las ondas de la isla.

use super::AudioFrame;

/// Por debajo de este nivel (dB respecto al máximo) el volumen se muestra como 0.
pub const FLOOR_DB: f32 = -60.0;

/// RMS → volumen entre 0 y 1, en escala de decibelios (así lo que se oye bajito también se ve):
/// −60 dB o menos = 0 y 0 dB (máximo digital) = 1.
pub fn level_from_rms(rms: f32) -> f32 {
    if rms <= 0.0 {
        return 0.0;
    }
    let db = 20.0 * rms.log10();
    ((db - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0)
}

/// Acumula audio y entrega un volumen cada `interval_secs` de **tiempo de audio** (no de reloj),
/// así que es determinista y se puede probar sin esperar.
pub struct LevelMeter {
    interval_secs: f64,
    sum_squares: f64,
    samples: usize,
    secs: f64,
    last_level: f32,
}

impl LevelMeter {
    pub fn new(interval_secs: f64) -> Self {
        Self {
            interval_secs,
            sum_squares: 0.0,
            samples: 0,
            secs: 0.0,
            last_level: 0.0,
        }
    }

    /// Añade un trozo de audio. Devuelve el volumen cuando se completa un intervalo.
    pub fn push(&mut self, frame: &AudioFrame) -> Option<f32> {
        self.sum_squares += frame
            .samples
            .iter()
            .map(|s| f64::from(*s) * f64::from(*s))
            .sum::<f64>();
        self.samples += frame.samples.len();
        self.secs += frame.duration_secs();

        if self.secs < self.interval_secs || self.samples == 0 {
            return None;
        }
        let rms = (self.sum_squares / self.samples as f64).sqrt() as f32;
        self.sum_squares = 0.0;
        self.samples = 0;
        self.secs = 0.0;
        self.last_level = level_from_rms(rms);
        Some(self.last_level)
    }

    /// Para cuando deja de llegar audio (silencio): baja el volumen a 0, una sola vez.
    pub fn idle(&mut self) -> Option<f32> {
        if self.last_level > 0.0 {
            self.last_level = 0.0;
            self.sum_squares = 0.0;
            self.samples = 0;
            self.secs = 0.0;
            Some(0.0)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn constant_frame(value: f32, millis: usize) -> AudioFrame {
        let frames = 48 * millis; // 48 kHz
        AudioFrame {
            samples: vec![value; frames * 2],
            sample_rate: 48_000,
            channels: 2,
        }
    }

    #[test]
    fn level_maps_decibels_to_zero_one() {
        assert_eq!(level_from_rms(0.0), 0.0);
        assert!((level_from_rms(1.0) - 1.0).abs() < 1e-6); // 0 dB
        assert!(level_from_rms(0.0009) == 0.0); // por debajo de −60 dB
        assert!((level_from_rms(0.0316) - 0.5).abs() < 0.01); // ≈ −30 dB
        assert!((level_from_rms(0.1) - 2.0 / 3.0).abs() < 0.01); // −20 dB
        assert_eq!(level_from_rms(10.0), 1.0); // nunca pasa de 1
    }

    #[test]
    fn level_grows_with_volume() {
        let quiet = level_from_rms(0.01);
        let medium = level_from_rms(0.1);
        let loud = level_from_rms(0.5);
        assert!(quiet < medium && medium < loud);
    }

    #[test]
    fn meter_emits_once_per_interval_of_audio() {
        let mut meter = LevelMeter::new(0.033);
        // Trozos de 10 ms: hacen falta 4 para pasar de 33 ms.
        assert_eq!(meter.push(&constant_frame(0.1, 10)), None);
        assert_eq!(meter.push(&constant_frame(0.1, 10)), None);
        assert_eq!(meter.push(&constant_frame(0.1, 10)), None);
        let level = meter
            .push(&constant_frame(0.1, 10))
            .expect("completa el intervalo");
        assert!((level - 2.0 / 3.0).abs() < 0.01);
        // Y vuelve a empezar de cero.
        assert_eq!(meter.push(&constant_frame(0.1, 10)), None);
    }

    #[test]
    fn meter_reports_silence_as_zero() {
        let mut meter = LevelMeter::new(0.02);
        let level = meter
            .push(&constant_frame(0.0, 20))
            .expect("intervalo completo");
        assert_eq!(level, 0.0);
    }

    #[test]
    fn idle_drops_the_level_to_zero_only_once() {
        let mut meter = LevelMeter::new(0.02);
        assert_eq!(meter.idle(), None); // nunca hubo volumen
        meter
            .push(&constant_frame(0.5, 20))
            .expect("intervalo completo");
        assert_eq!(meter.idle(), Some(0.0));
        assert_eq!(meter.idle(), None);
    }
}
