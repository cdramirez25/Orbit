//! Parte el audio en frases usando solo la energía (sin modelos): empieza una frase cuando hay voz,
//! pide parciales mientras dura y la cierra tras una pausa o al llegar al tope de duración.

use std::collections::VecDeque;

/// Frecuencia del audio que entra (la del `Normalizer`).
pub const SAMPLE_RATE: usize = 16_000;

/// Ventana con la que se mide la energía: 20 ms.
const HOP: usize = SAMPLE_RATE / 50;
/// Volumen (RMS) a partir del cual hay "algo sonando": ≈ −42 dBFS.
const SPEECH_RMS: f32 = 0.008;
/// Audio previo al primer sonido que se conserva, para no comerse el inicio de la palabra (300 ms).
const PRE_ROLL: usize = 15 * HOP;
/// Silencio que cierra una frase (800 ms).
const END_SILENCE: usize = 40 * HOP;
/// Menos sonido que esto (300 ms) es un chasquido, no una frase: se descarta.
const MIN_SPEECH: usize = 15 * HOP;
/// Cada cuánto audio nuevo se pide un parcial.
const PARTIAL_EVERY: usize = SAMPLE_RATE * 8 / 10;
/// No se pide un parcial hasta tener al menos este audio (600 ms).
const MIN_PARTIAL: usize = SAMPLE_RATE * 6 / 10;
/// Una frase nunca pasa de esto: se cierra aunque siga habiendo voz (así el parcial no crece sin fin).
const MAX_UTTERANCE: usize = SAMPLE_RATE * 12;
/// Silencio que se deja tras la última voz al cerrar una frase (200 ms).
const TAIL: usize = 10 * HOP;

/// Lo que el segmentador pide transcribir.
#[derive(Debug, Clone, PartialEq)]
pub enum Segment {
    /// La frase en curso, hasta ahora: el texto aún puede cambiar.
    Partial(Vec<f32>),
    /// La frase terminada: el texto es definitivo.
    Final(Vec<f32>),
}

pub struct Segmenter {
    /// Muestras que no llegan a formar una ventana todavía.
    pending: Vec<f32>,
    /// Últimos 300 ms de silencio, por si la siguiente ventana trae voz.
    pre_roll: VecDeque<f32>,
    utterance: Vec<f32>,
    in_speech: bool,
    /// Ventanas seguidas en silencio dentro de la frase.
    silent_samples: usize,
    /// Sonido acumulado en la frase (para descartar chasquidos).
    speech_samples: usize,
    /// Audio desde el último parcial.
    since_partial: usize,
    /// Dónde acabó la última voz dentro de la frase.
    last_voice_end: usize,
}

impl Segmenter {
    pub fn new() -> Self {
        Self {
            pending: Vec::new(),
            pre_roll: VecDeque::with_capacity(PRE_ROLL),
            utterance: Vec::new(),
            in_speech: false,
            silent_samples: 0,
            speech_samples: 0,
            since_partial: 0,
            last_voice_end: 0,
        }
    }

    /// Procesa audio nuevo y devuelve lo que hay que transcribir, en orden.
    pub fn push(&mut self, samples: &[f32]) -> Vec<Segment> {
        let mut data = std::mem::take(&mut self.pending);
        data.extend_from_slice(samples);

        let mut out = Vec::new();
        let mut windows = data.chunks_exact(HOP);
        for window in windows.by_ref() {
            self.step(window, &mut out);
        }
        self.pending = windows.remainder().to_vec();
        out
    }

    fn step(&mut self, window: &[f32], out: &mut Vec<Segment>) {
        let loud = rms(window) >= SPEECH_RMS;

        if !self.in_speech {
            if loud {
                self.begin(window);
            } else {
                self.pre_roll.extend(window);
                let excess = self.pre_roll.len().saturating_sub(PRE_ROLL);
                self.pre_roll.drain(..excess);
            }
            return;
        }

        self.utterance.extend_from_slice(window);
        self.since_partial += window.len();
        if loud {
            self.silent_samples = 0;
            self.speech_samples += window.len();
            self.last_voice_end = self.utterance.len();
        } else {
            self.silent_samples += window.len();
        }

        if self.silent_samples >= END_SILENCE || self.utterance.len() >= MAX_UTTERANCE {
            self.finish(out);
        } else if loud
            && self.since_partial >= PARTIAL_EVERY
            && self.utterance.len() >= MIN_PARTIAL
            && self.speech_samples >= MIN_SPEECH
        {
            self.since_partial = 0;
            out.push(Segment::Partial(self.utterance.clone()));
        }
    }

    fn begin(&mut self, window: &[f32]) {
        self.in_speech = true;
        self.utterance.clear();
        self.utterance.extend(self.pre_roll.drain(..));
        self.utterance.extend_from_slice(window);
        self.silent_samples = 0;
        self.speech_samples = window.len();
        self.since_partial = 0;
        self.last_voice_end = self.utterance.len();
    }

    fn finish(&mut self, out: &mut Vec<Segment>) {
        let enough = self.speech_samples >= MIN_SPEECH;
        let mut utterance = std::mem::take(&mut self.utterance);
        self.in_speech = false;
        self.pre_roll.clear();
        if enough {
            utterance.truncate((self.last_voice_end + TAIL).min(utterance.len()));
            out.push(Segment::Final(utterance));
        }
    }
}

impl Default for Segmenter {
    fn default() -> Self {
        Self::new()
    }
}

/// Descarta lo que ya no sirve: un parcial seguido de otro parcial o de un final está obsoleto
/// (sobre todo si la transcripción fue más lenta que el audio y se juntó una tanda).
pub fn coalesce(segments: Vec<Segment>) -> Vec<Segment> {
    let last = segments.len().saturating_sub(1);
    segments
        .into_iter()
        .enumerate()
        .filter(|(index, segment)| matches!(segment, Segment::Final(_)) || *index == last)
        .map(|(_, segment)| segment)
        .collect()
}

fn rms(window: &[f32]) -> f32 {
    if window.is_empty() {
        return 0.0;
    }
    (window.iter().map(|s| s * s).sum::<f32>() / window.len() as f32).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOUD: f32 = 0.2;

    fn tone(amplitude: f32, millis: usize) -> Vec<f32> {
        (0..SAMPLE_RATE * millis / 1000)
            .map(|i| amplitude * (i as f32 * 0.3).sin())
            .collect()
    }

    fn silence(millis: usize) -> Vec<f32> {
        vec![0.0; SAMPLE_RATE * millis / 1000]
    }

    fn feed(segmenter: &mut Segmenter, parts: &[Vec<f32>]) -> Vec<Segment> {
        parts.iter().flat_map(|part| segmenter.push(part)).collect()
    }

    fn finals(segments: &[Segment]) -> Vec<&Vec<f32>> {
        segments
            .iter()
            .filter_map(|s| match s {
                Segment::Final(audio) => Some(audio),
                Segment::Partial(_) => None,
            })
            .collect()
    }

    fn partials(segments: &[Segment]) -> usize {
        segments
            .iter()
            .filter(|s| matches!(s, Segment::Partial(_)))
            .count()
    }

    #[test]
    fn silence_alone_asks_for_nothing() {
        let mut segmenter = Segmenter::new();
        assert!(segmenter.push(&silence(3000)).is_empty());
    }

    #[test]
    fn a_phrase_followed_by_a_pause_produces_one_final() {
        let mut segmenter = Segmenter::new();
        let segments = feed(&mut segmenter, &[tone(LOUD, 500), silence(1000)]);

        assert_eq!(finals(&segments).len(), 1);
        // 300 ms de pre-roll no hay (venía de la nada) + 500 ms de voz + 200 ms de cola.
        let audio = finals(&segments)[0];
        let seconds = audio.len() as f32 / SAMPLE_RATE as f32;
        assert!((0.65..=0.8).contains(&seconds), "dura {seconds} s");
    }

    #[test]
    fn a_long_phrase_produces_partials_before_the_final() {
        let mut segmenter = Segmenter::new();
        let segments = feed(&mut segmenter, &[tone(LOUD, 3000), silence(1000)]);

        // Un parcial cada 0.8 s de audio: en 3 s caben 3.
        assert_eq!(partials(&segments), 3);
        assert_eq!(finals(&segments).len(), 1);
        // El orden importa: los parciales van antes del final.
        assert!(matches!(segments.last(), Some(Segment::Final(_))));
    }

    #[test]
    fn a_short_click_is_not_a_phrase() {
        let mut segmenter = Segmenter::new();
        let segments = feed(&mut segmenter, &[tone(LOUD, 100), silence(1500)]);
        assert!(segments.is_empty());
    }

    #[test]
    fn a_pause_shorter_than_the_limit_keeps_one_phrase() {
        let mut segmenter = Segmenter::new();
        let segments = feed(
            &mut segmenter,
            &[
                tone(LOUD, 600),
                silence(400),
                tone(LOUD, 600),
                silence(1000),
            ],
        );
        assert_eq!(finals(&segments).len(), 1);
    }

    #[test]
    fn two_phrases_separated_by_a_long_pause_give_two_finals() {
        let mut segmenter = Segmenter::new();
        let segments = feed(
            &mut segmenter,
            &[
                tone(LOUD, 600),
                silence(1200),
                tone(LOUD, 600),
                silence(1200),
            ],
        );
        assert_eq!(finals(&segments).len(), 2);
    }

    #[test]
    fn continuous_speech_is_cut_at_the_maximum_length() {
        let mut segmenter = Segmenter::new();
        let segments = feed(&mut segmenter, &[tone(LOUD, 13_000)]);

        let finals = finals(&segments);
        assert_eq!(finals.len(), 1);
        assert!(finals[0].len() <= MAX_UTTERANCE + TAIL);
    }

    #[test]
    fn the_start_of_the_phrase_keeps_a_bit_of_the_audio_before_it() {
        let mut segmenter = Segmenter::new();
        let segments = feed(
            &mut segmenter,
            &[silence(1000), tone(LOUD, 500), silence(1000)],
        );

        let seconds = finals(&segments)[0].len() as f32 / SAMPLE_RATE as f32;
        // 300 ms de pre-roll + 500 de voz + 200 de cola.
        assert!((0.95..=1.1).contains(&seconds), "dura {seconds} s");
    }

    #[test]
    fn the_result_does_not_depend_on_how_the_audio_is_split() {
        let audio: Vec<f32> = [tone(LOUD, 1500), silence(1000)].concat();

        let mut whole = Segmenter::new();
        let expected = whole.push(&audio);

        let mut pieces = Segmenter::new();
        let mut got = Vec::new();
        for chunk in audio.chunks(777) {
            got.extend(pieces.push(chunk));
        }
        assert_eq!(got, expected);
    }

    #[test]
    fn coalesce_keeps_every_final_and_only_the_last_partial() {
        let p = |n: usize| Segment::Partial(vec![0.0; n]);
        let f = |n: usize| Segment::Final(vec![0.0; n]);

        // Un parcial seguido de algo está obsoleto.
        assert_eq!(coalesce(vec![p(1), p(2), p(3)]), vec![p(3)]);
        assert_eq!(coalesce(vec![p(1), p(2), f(3)]), vec![f(3)]);
        // Un parcial de una frase nueva detrás de un final sí vale.
        assert_eq!(coalesce(vec![f(1), p(2)]), vec![f(1), p(2)]);
        assert_eq!(coalesce(vec![f(1), f(2)]), vec![f(1), f(2)]);
        assert!(coalesce(Vec::new()).is_empty());
    }
}
