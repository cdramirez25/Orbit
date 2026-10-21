//! Eventos de dominio y el puerto `EventSink` (§4.0).
//!
//! El núcleo (`pipeline/`, `modules/`) publica `DomainEvent`s a través de `EventSink` y nunca
//! conoce Tauri. `TauriEventSink` es el adaptador que los traduce a eventos hacia el frontend;
//! en tests se usa `testing::FakeEventSink`. El formato del payload es el espejo de
//! `src/types/pipeline.ts`: si cambias uno, cambia el otro.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

// Las variantes sin emisor todavía se usan desde las Fases 2–4 (audio, STT, LLM).
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PipelineState {
    Idle,
    Listening,
    Thinking,
    Answering,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbitError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub enum DomainEvent {
    PipelineState(PipelineState),
    AudioLevel(f32),
    SttPartial {
        text: String,
    },
    SttFinal {
        text: String,
        end_of_utterance: bool,
    },
    LlmDelta {
        text: String,
    },
    LlmDone,
    /// El historial del portapapeles cambió (la interfaz vuelve a pedirlo).
    ClipboardChanged,
    Error(OrbitError),
}

impl DomainEvent {
    /// Nombre del evento en el canal hacia el frontend.
    pub fn name(&self) -> &'static str {
        match self {
            Self::PipelineState(_) => "pipeline:state",
            Self::AudioLevel(_) => "audio:level",
            Self::SttPartial { .. } => "stt:partial",
            Self::SttFinal { .. } => "stt:final",
            Self::LlmDelta { .. } => "llm:delta",
            Self::LlmDone => "llm:done",
            Self::ClipboardChanged => "clipboard:changed",
            Self::Error(_) => "error",
        }
    }

    pub fn payload(&self) -> Value {
        match self {
            Self::PipelineState(state) => json!(state),
            Self::AudioLevel(level) => json!(level),
            Self::SttPartial { text } | Self::LlmDelta { text } => json!({ "text": text }),
            Self::SttFinal {
                text,
                end_of_utterance,
            } => json!({ "text": text, "endOfUtterance": end_of_utterance }),
            Self::LlmDone | Self::ClipboardChanged => Value::Null,
            Self::Error(error) => json!(error),
        }
    }
}

/// Puerto de salida de eventos de dominio.
pub trait EventSink: Send + Sync {
    fn publish(&self, event: DomainEvent);
}

/// Adaptador: traduce los eventos de dominio a eventos de Tauri.
pub struct TauriEventSink {
    app: AppHandle,
}

impl TauriEventSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl EventSink for TauriEventSink {
    fn publish(&self, event: DomainEvent) {
        // Nunca se registra el payload: puede contener transcripciones.
        if let Err(error) = self.app.emit(event.name(), event.payload()) {
            tracing::warn!(event = event.name(), %error, "no se pudo emitir el evento");
        }
    }
}

#[cfg(test)]
pub mod testing {
    use std::sync::Mutex;

    use super::{DomainEvent, EventSink};

    /// Sumidero simulado: guarda los eventos para inspeccionarlos en tests del pipeline.
    #[derive(Default)]
    pub struct FakeEventSink {
        events: Mutex<Vec<DomainEvent>>,
    }

    impl FakeEventSink {
        pub fn events(&self) -> Vec<DomainEvent> {
            self.events.lock().map(|e| e.clone()).unwrap_or_default()
        }
    }

    impl EventSink for FakeEventSink {
        fn publish(&self, event: DomainEvent) {
            if let Ok(mut events) = self.events.lock() {
                events.push(event);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::FakeEventSink;
    use super::*;

    #[test]
    fn fake_sink_records_events_in_order() {
        let sink = FakeEventSink::default();
        sink.publish(DomainEvent::PipelineState(PipelineState::Listening));
        sink.publish(DomainEvent::LlmDone);
        assert_eq!(
            sink.events(),
            vec![
                DomainEvent::PipelineState(PipelineState::Listening),
                DomainEvent::LlmDone
            ]
        );
    }

    #[test]
    fn names_match_the_frontend_contract() {
        let names = [
            (
                DomainEvent::PipelineState(PipelineState::Idle),
                "pipeline:state",
            ),
            (DomainEvent::AudioLevel(0.5), "audio:level"),
            (
                DomainEvent::SttPartial {
                    text: String::new(),
                },
                "stt:partial",
            ),
            (
                DomainEvent::SttFinal {
                    text: String::new(),
                    end_of_utterance: true,
                },
                "stt:final",
            ),
            (
                DomainEvent::LlmDelta {
                    text: String::new(),
                },
                "llm:delta",
            ),
            (DomainEvent::LlmDone, "llm:done"),
            (DomainEvent::ClipboardChanged, "clipboard:changed"),
        ];
        for (event, name) in names {
            assert_eq!(event.name(), name);
        }
    }

    #[test]
    fn payloads_match_the_frontend_types() {
        assert_eq!(
            DomainEvent::PipelineState(PipelineState::Answering).payload(),
            json!("answering")
        );
        assert_eq!(
            DomainEvent::SttFinal {
                text: "hola".into(),
                end_of_utterance: true
            }
            .payload(),
            json!({ "text": "hola", "endOfUtterance": true })
        );
        assert_eq!(DomainEvent::LlmDone.payload(), Value::Null);
        assert_eq!(
            DomainEvent::Error(OrbitError {
                code: "net".into(),
                message: "sin red".into(),
                recoverable: true
            })
            .payload(),
            json!({ "code": "net", "message": "sin red", "recoverable": true })
        );
    }
}
