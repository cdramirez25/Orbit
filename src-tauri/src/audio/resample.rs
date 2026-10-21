//! Normalización del audio al formato que espera el STT: 16 kHz, mono, PCM de 16 bits.

use super::AudioFrame;

/// Frecuencia de salida.
pub const TARGET_RATE: u32 = 16_000;

/// Convierte audio de cualquier frecuencia y número de canales a 16 kHz mono PCM16, en
/// streaming (conserva el estado entre trozos, así que no hay cortes en las uniones).
///
/// Mezcla los canales promediándolos y remuestrea promediando las muestras de entrada que caen
/// en cada muestra de salida (filtro de caja): barato y suficiente para voz.
pub struct Normalizer {
    rate: u32,
    sum: f64,
    weight: f64,
}

impl Normalizer {
    pub fn new() -> Self {
        Self {
            rate: 0,
            sum: 0.0,
            weight: 0.0,
        }
    }

    pub fn process(&mut self, frame: &AudioFrame) -> Vec<i16> {
        if frame.channels == 0 || frame.sample_rate == 0 {
            return Vec::new();
        }
        // Si el dispositivo cambia de frecuencia a mitad de captura, se reinicia la ventana.
        if frame.sample_rate != self.rate {
            self.rate = frame.sample_rate;
            self.sum = 0.0;
            self.weight = 0.0;
        }

        // Muestras de entrada que caben en una muestra de salida (48 kHz → 3.0).
        let window = f64::from(self.rate) / f64::from(TARGET_RATE);
        let channels = usize::from(frame.channels);
        let mut out =
            Vec::with_capacity(frame.frame_count() * TARGET_RATE as usize / self.rate as usize + 2);

        for chunk in frame.samples.chunks_exact(channels) {
            let mono = chunk.iter().map(|s| f64::from(*s)).sum::<f64>() / channels as f64;
            let mut remaining = 1.0_f64;
            while remaining > 1e-9 {
                let room = window - self.weight;
                if remaining < room {
                    self.sum += mono * remaining;
                    self.weight += remaining;
                    break;
                }
                self.sum += mono * room;
                out.push(to_pcm16((self.sum / window) as f32));
                remaining -= room;
                self.sum = 0.0;
                self.weight = 0.0;
            }
        }
        out
    }
}

impl Default for Normalizer {
    fn default() -> Self {
        Self::new()
    }
}

/// `f32` (−1.0…1.0) → `i16`, recortando lo que se pase.
pub fn to_pcm16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(samples: Vec<f32>, sample_rate: u32, channels: u16) -> AudioFrame {
        AudioFrame {
            samples,
            sample_rate,
            channels,
        }
    }

    /// Seno de `hz` Hz, `millis` ms, a `rate` Hz, mono, amplitud `amp`.
    fn sine(hz: f32, amp: f32, millis: usize, rate: u32) -> Vec<f32> {
        let count = rate as usize * millis / 1000;
        (0..count)
            .map(|n| amp * (2.0 * std::f32::consts::PI * hz * n as f32 / rate as f32).sin())
            .collect()
    }

    #[test]
    fn pcm16_conversion_clips_and_rounds() {
        assert_eq!(to_pcm16(0.0), 0);
        assert_eq!(to_pcm16(1.0), i16::MAX);
        assert_eq!(to_pcm16(-1.0), -i16::MAX);
        assert_eq!(to_pcm16(5.0), i16::MAX);
        assert_eq!(to_pcm16(-5.0), -i16::MAX);
        assert_eq!(to_pcm16(0.5), 16_384);
    }

    #[test]
    fn dc_level_is_preserved_from_48k_stereo() {
        let mut normalizer = Normalizer::new();
        let out = normalizer.process(&frame(vec![0.5; 4800 * 2], 48_000, 2));
        assert_eq!(out.len(), 1600); // 100 ms a 16 kHz
        assert!(out.iter().all(|s| (*s - 16_384).abs() <= 1));
    }

    #[test]
    fn output_length_follows_the_rate_ratio() {
        for rate in [48_000_u32, 44_100, 32_000, 16_000, 8_000] {
            let mut normalizer = Normalizer::new();
            let input = vec![0.1; rate as usize]; // 1 s mono
            let out = normalizer.process(&frame(input, rate, 1));
            assert!(
                (out.len() as i64 - 16_000).abs() <= 1,
                "{rate} Hz → {} muestras",
                out.len()
            );
        }
    }

    #[test]
    fn channels_are_averaged_into_mono() {
        let mut normalizer = Normalizer::new();
        // Izquierdo = 1.0 y derecho = −1.0 → promedio 0.
        let interleaved: Vec<f32> = (0..4800).flat_map(|_| [1.0, -1.0]).collect();
        let out = normalizer.process(&frame(interleaved, 48_000, 2));
        assert!(out.iter().all(|s| s.abs() <= 1));
        // Solo el izquierdo → la mitad de la amplitud.
        let mut normalizer = Normalizer::new();
        let left_only: Vec<f32> = (0..4800).flat_map(|_| [1.0, 0.0]).collect();
        let out = normalizer.process(&frame(left_only, 48_000, 2));
        assert!(out.iter().all(|s| (*s - 16_384).abs() <= 1));
    }

    #[test]
    fn a_1khz_tone_keeps_its_amplitude() {
        let mut normalizer = Normalizer::new();
        let out = normalizer.process(&frame(sine(1000.0, 0.8, 200, 48_000), 48_000, 1));
        let peak = out.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0);
        let expected = 0.8 * f32::from(i16::MAX);
        // El filtro de caja casi no atenúa 1 kHz (≈ 0.5 %).
        assert!(f32::from(peak) > expected * 0.97, "pico {peak}");
        assert!(f32::from(peak) <= expected * 1.01, "pico {peak}");
    }

    #[test]
    fn processing_in_chunks_equals_processing_at_once() {
        let signal = sine(440.0, 0.5, 100, 48_000);

        let mut whole = Normalizer::new();
        let expected = whole.process(&frame(signal.clone(), 48_000, 1));

        let mut chunked = Normalizer::new();
        let mut out = Vec::new();
        // Trozos de tamaños raros (no múltiplos de 3) para forzar el estado entre uniones.
        for piece in signal.chunks(1001) {
            out.extend(chunked.process(&frame(piece.to_vec(), 48_000, 1)));
        }
        assert_eq!(out, expected);
    }

    #[test]
    fn already_16k_mono_passes_through() {
        let mut normalizer = Normalizer::new();
        let input = sine(300.0, 0.5, 50, 16_000);
        let out = normalizer.process(&frame(input.clone(), 16_000, 1));
        assert_eq!(out.len(), input.len());
        for (sample, original) in out.iter().zip(&input) {
            assert!((*sample - to_pcm16(*original)).abs() <= 1);
        }
    }

    #[test]
    fn a_rate_change_restarts_cleanly() {
        let mut normalizer = Normalizer::new();
        normalizer.process(&frame(vec![0.9; 1000], 48_000, 1)); // deja una ventana a medias
        let out = normalizer.process(&frame(vec![0.2; 441 * 10], 44_100, 1));
        // Sin restos del bloque anterior (0.9): todo vale 0.2.
        assert!(out.iter().all(|s| (*s - to_pcm16(0.2)).abs() <= 1));
    }

    #[test]
    fn degenerate_frames_give_nothing() {
        let mut normalizer = Normalizer::new();
        assert!(normalizer
            .process(&frame(vec![0.5; 10], 48_000, 0))
            .is_empty());
        assert!(normalizer.process(&frame(vec![0.5; 10], 0, 2)).is_empty());
        assert!(normalizer.process(&frame(vec![], 48_000, 2)).is_empty());
    }
}
