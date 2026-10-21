use std::sync::PoisonError;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, State};

use super::CommandError;
use crate::ai::AiError;
use crate::app_state::AppState;
use crate::events::DomainEvent;
use crate::sessions::{Message, SessionUpdate, SessionsState};

/// Lo último que se dijo puede estar todavía en camino desde la captura de audio: se espera un
/// momento antes de cerrar la frase al terminar de grabar la pregunta.
const TAIL_WAIT: Duration = Duration::from_millis(350);
/// Cuánto se espera a que la transcripción termine de procesar la última frase.
const FLUSH_TIMEOUT: Duration = Duration::from_secs(10);

fn changed(state: &AppState) {
    state.events.publish(DomainEvent::SessionsChanged);
}

/// Las sesiones y cuál está activa.
#[tauri::command]
pub fn session_get_state(state: State<'_, AppState>) -> Result<SessionsState, CommandError> {
    Ok(state.sessions.state()?)
}

/// Crea una sesión (con su prompt) y la deja activa.
#[tauri::command]
pub fn session_create(
    state: State<'_, AppState>,
    name: String,
    prompt: Option<String>,
) -> Result<SessionsState, CommandError> {
    let result = state
        .sessions
        .create(&name, prompt.as_deref().unwrap_or_default())?;
    changed(&state);
    Ok(result)
}

/// Cambia el nombre, el prompt o la respuesta automática de una sesión.
#[tauri::command]
pub fn session_update(
    state: State<'_, AppState>,
    id: i64,
    update: SessionUpdate,
) -> Result<SessionsState, CommandError> {
    let result = state.sessions.update(id, update)?;
    changed(&state);
    Ok(result)
}

/// Borra una sesión con todo su historial.
#[tauri::command]
pub fn session_delete(state: State<'_, AppState>, id: i64) -> Result<SessionsState, CommandError> {
    let result = state.sessions.delete(id)?;
    changed(&state);
    Ok(result)
}

/// Elige la sesión con la que se pregunta (`null`: ninguna).
#[tauri::command]
pub fn session_set_active(
    state: State<'_, AppState>,
    id: Option<i64>,
) -> Result<SessionsState, CommandError> {
    let result = state.sessions.set_active(id)?;
    changed(&state);
    Ok(result)
}

/// Las preguntas y respuestas de una sesión, de la más antigua a la más nueva.
#[tauri::command]
pub fn session_messages(state: State<'_, AppState>, id: i64) -> Result<Vec<Message>, CommandError> {
    Ok(state.sessions.messages(id)?)
}

/// Vacía el historial de una sesión (conserva la sesión y su prompt).
#[tauri::command]
pub fn session_clear(state: State<'_, AppState>, id: i64) -> Result<(), CommandError> {
    state.sessions.clear_messages(id)?;
    changed(&state);
    Ok(())
}

/// Empieza a grabar una pregunta: se pone a escuchar el audio del sistema y las frases que salgan
/// se juntan hasta `question_finish`.
#[tauri::command]
pub fn question_start(state: State<'_, AppState>) -> Result<(), CommandError> {
    state.recorder.begin();
    let mut pipeline = state
        .pipeline
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if !pipeline.is_listening() {
        if let Err(error) = pipeline.start() {
            state.recorder.cancel();
            return Err(error.into());
        }
    }
    Ok(())
}

/// Termina la pregunta: cierra la última frase, deja de escuchar y le pregunta a la IA, con el
/// contexto de la sesión. Devuelve la pregunta; la respuesta llega por los eventos `llm:*`.
#[tauri::command]
pub async fn question_finish(app: AppHandle) -> Result<String, CommandError> {
    let question = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        thread::sleep(TAIL_WAIT);
        {
            let pipeline = state
                .pipeline
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            pipeline.flush(FLUSH_TIMEOUT);
        }
        let question = state.recorder.finish();
        state
            .pipeline
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .stop();

        let question = question.unwrap_or_default();
        if question.trim().is_empty() {
            return Err(AiError::NoQuestion);
        }
        state.prompter.ask(question.clone());
        Ok(question)
    })
    .await
    .map_err(|error| AiError::Network(error.to_string()))??;
    Ok(question)
}

/// ¿Se está grabando una pregunta? (la interfaz lo pregunta al abrirse, por si ya estaba en marcha).
#[tauri::command]
pub fn question_is_recording(state: State<'_, AppState>) -> bool {
    state.recorder.is_recording()
}

/// Cancela la grabación de la pregunta sin responder, y deja de escuchar.
#[tauri::command]
pub fn question_cancel(state: State<'_, AppState>) {
    state.recorder.cancel();
    state
        .pipeline
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .stop();
}
