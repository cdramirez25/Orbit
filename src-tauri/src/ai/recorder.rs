//! Grabar una pregunta con el botón: mientras se graba, las frases que salgan de la transcripción
//! se juntan; al terminar, todo lo dicho es la pregunta. No habla con la IA ni con el audio: solo
//! recoge texto, para que el comando de "terminar" decida qué hacer con él.

use std::sync::{Mutex, PoisonError};

#[derive(Default)]
pub struct QuestionRecorder {
    /// `None` = no se está grabando; `Some` = las frases oídas desde que se empezó.
    lines: Mutex<Option<Vec<String>>>,
}

impl QuestionRecorder {
    /// Empieza a grabar una pregunta nueva (descarta lo que hubiera sin terminar).
    pub fn begin(&self) {
        *self.guard() = Some(Vec::new());
    }

    pub fn is_recording(&self) -> bool {
        self.guard().is_some()
    }

    /// Apunta una frase terminada si se está grabando. Devuelve si se apuntó.
    pub fn collect(&self, text: &str) -> bool {
        match self.guard().as_mut() {
            Some(lines) => {
                let text = text.trim();
                if !text.is_empty() {
                    lines.push(text.to_string());
                }
                true
            }
            None => false,
        }
    }

    /// Termina la grabación y devuelve la pregunta (las frases unidas por espacios); `None` si no se
    /// estaba grabando. Puede ser un texto vacío si no se dijo nada.
    pub fn finish(&self) -> Option<String> {
        self.guard().take().map(|lines| lines.join(" "))
    }

    /// Cancela la grabación sin responder.
    pub fn cancel(&self) {
        *self.guard() = None;
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, Option<Vec<String>>> {
        self.lines.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_collected_until_recording_starts() {
        let recorder = QuestionRecorder::default();
        assert!(!recorder.is_recording());
        assert!(!recorder.collect("hola"));
        assert_eq!(recorder.finish(), None);
    }

    #[test]
    fn the_phrases_heard_while_recording_become_the_question() {
        let recorder = QuestionRecorder::default();
        recorder.begin();
        assert!(recorder.is_recording());
        assert!(recorder.collect("  ¿Cuál es la capital "));
        assert!(recorder.collect("   ")); // vacía: se ignora, pero se está grabando
        assert!(recorder.collect("de Australia?"));

        assert_eq!(
            recorder.finish().as_deref(),
            Some("¿Cuál es la capital de Australia?")
        );
        assert!(!recorder.is_recording());
        assert_eq!(recorder.finish(), None);
    }

    #[test]
    fn a_recording_with_nothing_said_gives_an_empty_question() {
        let recorder = QuestionRecorder::default();
        recorder.begin();
        assert_eq!(recorder.finish().as_deref(), Some(""));
    }

    #[test]
    fn starting_again_discards_the_unfinished_one_and_cancel_stops_without_a_question() {
        let recorder = QuestionRecorder::default();
        recorder.begin();
        recorder.collect("vieja");
        recorder.begin();
        recorder.collect("nueva");
        assert_eq!(recorder.finish().as_deref(), Some("nueva"));

        recorder.begin();
        recorder.collect("algo");
        recorder.cancel();
        assert!(!recorder.is_recording());
        assert_eq!(recorder.finish(), None);
    }
}
