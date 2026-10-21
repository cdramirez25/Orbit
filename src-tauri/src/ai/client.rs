//! Adaptador HTTP de `LlmClient`: habla con Claude (formato de Anthropic) y con ChatGPT, Groq,
//! Ollama y Docker (formato de OpenAI), siempre en streaming. Usa el TLS del sistema operativo.
//! Nunca se registra la clave, lo que se pregunta ni lo que se responde.

use std::io::{BufRead, BufReader};
use std::time::Duration;

use serde_json::{json, Value};
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::Agent;

use super::providers::{ProviderId, Wire};
use super::{AiError, ChatTurn, LlmClient, Request, Target};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Tope de toda la petición, respuesta incluida: una respuesta de la isla es corta.
const TOTAL_TIMEOUT: Duration = Duration::from_secs(60);
const USER_AGENT: &str = concat!("Orbit/", env!("CARGO_PKG_VERSION"));
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Cuánto del mensaje de error del proveedor se conserva.
const MAX_ERROR_CHARS: usize = 160;

pub struct HttpLlm {
    agent: Agent,
}

impl HttpLlm {
    pub fn new() -> Self {
        let tls = TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(RootCerts::PlatformVerifier)
            .build();
        let config = Agent::config_builder()
            .tls_config(tls)
            // Los 4xx/5xx se leen aquí (traen el motivo en el cuerpo), no son un error de `ureq`.
            .http_status_as_error(false)
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_global(Some(TOTAL_TIMEOUT))
            .user_agent(USER_AGENT)
            .build();
        Self {
            agent: Agent::new_with_config(config),
        }
    }
}

impl Default for HttpLlm {
    fn default() -> Self {
        Self::new()
    }
}

/// Una línea del flujo (SSE) ya interpretada.
#[derive(Debug, PartialEq, Eq)]
enum Line {
    Skip,
    Delta(String),
    Done,
    Error(String),
}

fn truncate(text: &str) -> String {
    text.chars().take(MAX_ERROR_CHARS).collect()
}

fn parse_line(wire: Wire, line: &str) -> Line {
    let Some(data) = line.strip_prefix("data:") else {
        return Line::Skip;
    };
    let data = data.trim();
    if data.is_empty() {
        return Line::Skip;
    }
    if data == "[DONE]" {
        return Line::Done;
    }
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return Line::Skip;
    };
    if let Some(message) = value["error"]["message"].as_str() {
        return Line::Error(truncate(message));
    }
    match wire {
        Wire::OpenAi => match value["choices"][0]["delta"]["content"].as_str() {
            Some(text) if !text.is_empty() => Line::Delta(text.to_string()),
            _ => Line::Skip,
        },
        Wire::Anthropic => match value["type"].as_str() {
            Some("content_block_delta") => match value["delta"]["text"].as_str() {
                Some(text) if !text.is_empty() => Line::Delta(text.to_string()),
                _ => Line::Skip,
            },
            Some("message_stop") => Line::Done,
            _ => Line::Skip,
        },
    }
}

/// El historial más la pregunta nueva, como la lista de mensajes que esperan los dos formatos.
fn conversation(history: &[ChatTurn], user: &str) -> Vec<Value> {
    history
        .iter()
        .map(|turn| json!({ "role": turn.role.as_str(), "content": turn.content }))
        .chain(std::iter::once(json!({ "role": "user", "content": user })))
        .collect()
}

fn openai_body(target: &Target, request: &Request<'_>) -> Value {
    let mut messages = vec![json!({ "role": "system", "content": request.system })];
    messages.extend(conversation(request.history, request.user));
    let mut body = json!({
        "model": target.model,
        "stream": true,
        "messages": messages,
    });
    body[target.id.spec().max_tokens_field] = json!(request.max_tokens);
    // Los modelos gpt-oss de Groq razonan antes de contestar: con esfuerzo bajo tardan menos.
    if target.id == ProviderId::Groq && target.model.contains("gpt-oss") {
        body["reasoning_effort"] = json!("low");
    }
    body
}

fn anthropic_body(target: &Target, request: &Request<'_>) -> Value {
    json!({
        "model": target.model,
        "max_tokens": request.max_tokens,
        "stream": true,
        "system": request.system,
        "messages": conversation(request.history, request.user),
    })
}

/// El error de una respuesta 4xx/5xx, con el motivo que da el proveedor (sin la petición).
fn http_error(status: u16, body: &str) -> AiError {
    match status {
        401 | 403 => AiError::Unauthorized,
        429 => AiError::RateLimited,
        _ => {
            let message = serde_json::from_str::<Value>(body)
                .ok()
                .and_then(|value| value["error"]["message"].as_str().map(truncate));
            AiError::Provider(match message {
                Some(message) => format!("HTTP {status}: {message}"),
                None => format!("HTTP {status}"),
            })
        }
    }
}

/// Quita de la lista lo que no es un modelo de texto para conversar (voz, seguridad, imágenes…).
fn is_chat_model(id: &str) -> bool {
    const NOT_CHAT: [&str; 9] = [
        "whisper",
        "orpheus",
        "guard",
        "safeguard",
        "embed",
        "tts",
        "transcribe",
        "moderation",
        "image",
    ];
    let id = id.to_lowercase();
    !NOT_CHAT.iter().any(|word| id.contains(word))
}

impl LlmClient for HttpLlm {
    fn stream(
        &self,
        target: &Target,
        request: &Request<'_>,
        on_delta: &mut dyn FnMut(&str) -> bool,
    ) -> Result<(), AiError> {
        let wire = target.id.spec().wire;
        let base = target.base_url.trim_end_matches('/');
        let (url, body) = match wire {
            Wire::OpenAi => (
                format!("{base}/chat/completions"),
                openai_body(target, request),
            ),
            Wire::Anthropic => (
                format!("{base}/v1/messages"),
                anthropic_body(target, request),
            ),
        };

        let mut call = self.agent.post(&url);
        if let Some(key) = &target.api_key {
            call = match wire {
                Wire::OpenAi => call.header("Authorization", format!("Bearer {key}")),
                Wire::Anthropic => call
                    .header("x-api-key", key.as_str())
                    .header("anthropic-version", ANTHROPIC_VERSION),
            };
        }
        let mut response = call
            .send_json(&body)
            .map_err(|error| AiError::Network(error.to_string()))?;

        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            let text = response.body_mut().read_to_string().unwrap_or_default();
            return Err(http_error(status, &text));
        }

        let reader = BufReader::new(response.into_body().into_reader());
        let mut received = false;
        for line in reader.lines() {
            let line = line.map_err(|error| AiError::Network(error.to_string()))?;
            match parse_line(wire, &line) {
                Line::Skip => {}
                Line::Delta(text) => {
                    received = true;
                    if !on_delta(&text) {
                        return Ok(());
                    }
                }
                Line::Done => break,
                Line::Error(message) => return Err(AiError::Provider(message)),
            }
        }
        // Un 200 que no trae ni una palabra (otro formato, un modelo que solo "piensa"): no es éxito.
        if received {
            Ok(())
        } else {
            Err(AiError::BadResponse("la respuesta llegó vacía".into()))
        }
    }

    fn models(&self, target: &Target) -> Result<Vec<String>, AiError> {
        let wire = target.id.spec().wire;
        let base = target.base_url.trim_end_matches('/');
        let url = match wire {
            Wire::OpenAi => format!("{base}/models"),
            Wire::Anthropic => format!("{base}/v1/models"),
        };
        let mut call = self.agent.get(&url);
        if let Some(key) = &target.api_key {
            call = match wire {
                Wire::OpenAi => call.header("Authorization", format!("Bearer {key}")),
                Wire::Anthropic => call
                    .header("x-api-key", key.as_str())
                    .header("anthropic-version", ANTHROPIC_VERSION),
            };
        }
        let mut response = call
            .call()
            .map_err(|error| AiError::Network(error.to_string()))?;
        let status = response.status().as_u16();
        let text = response.body_mut().read_to_string().unwrap_or_default();
        if !(200..300).contains(&status) {
            return Err(http_error(status, &text));
        }
        let value: Value =
            serde_json::from_str(&text).map_err(|error| AiError::BadResponse(error.to_string()))?;
        let models = value["data"]
            .as_array()
            .ok_or_else(|| {
                AiError::BadResponse("la lista de modelos no tiene el formato esperado".into())
            })?
            .iter()
            .filter_map(|model| model["id"].as_str())
            .filter(|id| is_chat_model(id))
            .map(str::to_string)
            .collect();
        Ok(models)
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex};
    use std::thread;

    use super::*;
    use crate::ai::providers::ProviderId;

    /// Una petición tal como llegó al servidor de prueba.
    #[derive(Debug, Clone)]
    struct Recorded {
        path: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    impl Recorded {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str())
        }
    }

    fn read_request(stream: &mut TcpStream) -> Recorded {
        let mut data = Vec::new();
        let mut buffer = [0_u8; 1024];
        let header_end = loop {
            let read = stream.read(&mut buffer).unwrap_or(0);
            if read == 0 {
                break data.len();
            }
            data.extend_from_slice(&buffer[..read]);
            if let Some(at) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                break at + 4;
            }
        };
        let head = String::from_utf8_lossy(&data[..header_end]).to_string();
        let mut lines = head.lines();
        let path = lines
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or_default()
            .to_string();
        let headers: Vec<(String, String)> = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))
            .collect();
        let length: usize = headers
            .iter()
            .find(|(k, _)| k == "content-length")
            .and_then(|(_, v)| v.parse().ok())
            .unwrap_or(0);
        while data.len() < header_end + length {
            let read = stream.read(&mut buffer).unwrap_or(0);
            if read == 0 {
                break;
            }
            data.extend_from_slice(&buffer[..read]);
        }
        let body = String::from_utf8_lossy(&data[header_end..]).to_string();
        Recorded {
            path,
            headers,
            body,
        }
    }

    /// Servidor de prueba: contesta a cada petición con la siguiente respuesta de la lista.
    fn serve(responses: Vec<(u16, &'static str, String)>) -> (String, Arc<Mutex<Vec<Recorded>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let recorded = Arc::new(Mutex::new(Vec::new()));
        let shared = Arc::clone(&recorded);
        thread::spawn(move || {
            for (status, content_type, body) in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                shared.lock().unwrap().push(read_request(&mut stream));
                let head = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body.as_bytes());
            }
        });
        (format!("http://{address}"), recorded)
    }

    fn target(id: ProviderId, base_url: &str, key: Option<&str>) -> Target {
        Target {
            id,
            base_url: base_url.to_string(),
            model: "modelo-x".into(),
            api_key: key.map(str::to_string),
        }
    }

    fn ask(client: &HttpLlm, target: &Target) -> (Result<(), AiError>, String) {
        let mut text = String::new();
        let result = client.stream(
            target,
            &Request {
                system: "sé breve",
                history: &[],
                user: "¿Capital de Australia?",
                max_tokens: 50,
            },
            &mut |delta| {
                text.push_str(delta);
                true
            },
        );
        (result, text)
    }

    const OPENAI_STREAM: &str = concat!(
        "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"Can\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"berra\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{}}]}\n\n",
        "data: [DONE]\n\n",
    );

    const ANTHROPIC_STREAM: &str = concat!(
        "event: message_start\ndata: {\"type\":\"message_start\"}\n\n",
        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Can\"}}\n\n",
        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"berra\"}}\n\n",
        "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
    );

    #[test]
    fn an_openai_style_provider_streams_the_answer_with_its_key() {
        let (base, recorded) = serve(vec![(200, "text/event-stream", OPENAI_STREAM.into())]);
        let client = HttpLlm::new();

        let (result, text) = ask(
            &client,
            &target(
                ProviderId::Groq,
                &format!("{base}/openai/v1"),
                Some("gsk_clave"),
            ),
        );

        result.unwrap();
        assert_eq!(text, "Canberra");
        let request = recorded.lock().unwrap()[0].clone();
        assert_eq!(request.path, "/openai/v1/chat/completions");
        assert_eq!(request.header("authorization"), Some("Bearer gsk_clave"));
        let body: Value = serde_json::from_str(&request.body).unwrap();
        assert_eq!(body["model"], "modelo-x");
        assert_eq!(body["stream"], true);
        assert_eq!(body["max_completion_tokens"], 50);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], "¿Capital de Australia?");
    }

    #[test]
    fn local_providers_send_no_key_and_use_the_older_token_limit() {
        let (base, recorded) = serve(vec![(200, "text/event-stream", OPENAI_STREAM.into())]);
        let client = HttpLlm::new();

        let (result, text) = ask(
            &client,
            &target(ProviderId::Ollama, &format!("{base}/v1"), None),
        );

        result.unwrap();
        assert_eq!(text, "Canberra");
        let request = recorded.lock().unwrap()[0].clone();
        assert_eq!(request.header("authorization"), None);
        let body: Value = serde_json::from_str(&request.body).unwrap();
        assert_eq!(body["max_tokens"], 50);
        assert!(body.get("max_completion_tokens").is_none());
    }

    #[test]
    fn groq_reasoning_models_are_asked_for_low_effort_and_others_are_not() {
        let (base, recorded) = serve(vec![
            (200, "text/event-stream", OPENAI_STREAM.into()),
            (200, "text/event-stream", OPENAI_STREAM.into()),
        ]);
        let client = HttpLlm::new();
        let mut oss = target(ProviderId::Groq, &base, Some("k"));
        oss.model = "openai/gpt-oss-20b".into();
        ask(&client, &oss).0.unwrap();
        ask(&client, &target(ProviderId::Groq, &base, Some("k")))
            .0
            .unwrap();

        let bodies: Vec<Value> = recorded
            .lock()
            .unwrap()
            .iter()
            .map(|r| serde_json::from_str(&r.body).unwrap())
            .collect();
        assert_eq!(bodies[0]["reasoning_effort"], "low");
        assert!(bodies[1].get("reasoning_effort").is_none());
    }

    #[test]
    fn the_models_of_an_openai_style_provider_are_listed_without_voice_or_safety_models() {
        let list = r#"{"data":[{"id":"openai/gpt-oss-20b"},{"id":"whisper-large-v3"},{"id":"openai/gpt-oss-safeguard-20b"},{"id":"qwen/qwen3.8-27b"},{"id":"canopylabs/orpheus-v1-english"}]}"#;
        let (base, recorded) = serve(vec![(200, "application/json", list.into())]);

        let models = HttpLlm::new()
            .models(&target(
                ProviderId::Groq,
                &format!("{base}/openai/v1"),
                Some("gsk_clave"),
            ))
            .unwrap();

        assert_eq!(models, vec!["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]);
        let request = recorded.lock().unwrap()[0].clone();
        assert_eq!(request.path, "/openai/v1/models");
        assert_eq!(request.header("authorization"), Some("Bearer gsk_clave"));
    }

    #[test]
    fn claude_lists_its_models_with_its_own_headers_and_errors_keep_their_code() {
        let (base, recorded) = serve(vec![
            (
                200,
                "application/json",
                r#"{"data":[{"id":"claude-haiku-5-5"}]}"#.into(),
            ),
            (
                401,
                "application/json",
                r#"{"error":{"message":"invalid x-api-key"}}"#.into(),
            ),
            (200, "application/json", r#"{"no":"es una lista"}"#.into()),
        ]);
        let client = HttpLlm::new();
        let t = target(ProviderId::Claude, &base, Some("sk-ant-x"));

        assert_eq!(client.models(&t).unwrap(), vec!["claude-haiku-5-5"]);
        let request = recorded.lock().unwrap()[0].clone();
        assert_eq!(request.path, "/v1/models");
        assert_eq!(request.header("x-api-key"), Some("sk-ant-x"));
        assert_eq!(request.header("anthropic-version"), Some(ANTHROPIC_VERSION));

        assert_eq!(client.models(&t).unwrap_err().code(), "ai.unauthorized");
        assert_eq!(client.models(&t).unwrap_err().code(), "ai.badResponse");
    }

    fn turns() -> Vec<ChatTurn> {
        use crate::ai::Role;
        vec![
            ChatTurn {
                role: Role::User,
                content: "Mi número favorito es 7".into(),
            },
            ChatTurn {
                role: Role::Assistant,
                content: "Anotado: 7.".into(),
            },
        ]
    }

    #[test]
    fn the_session_history_goes_before_the_new_question_in_both_formats() {
        let (base, recorded) = serve(vec![
            (200, "text/event-stream", OPENAI_STREAM.into()),
            (200, "text/event-stream", ANTHROPIC_STREAM.into()),
        ]);
        let client = HttpLlm::new();
        let history = turns();
        let request = Request {
            system: "sé breve",
            history: &history,
            user: "¿Cuál es?",
            max_tokens: 50,
        };

        client
            .stream(
                &target(ProviderId::Groq, &base, Some("k")),
                &request,
                &mut |_| true,
            )
            .unwrap();
        client
            .stream(
                &target(ProviderId::Claude, &base, Some("k")),
                &request,
                &mut |_| true,
            )
            .unwrap();

        let bodies: Vec<Value> = recorded
            .lock()
            .unwrap()
            .iter()
            .map(|r| serde_json::from_str(&r.body).unwrap())
            .collect();
        // OpenAI: el sistema, el historial y la pregunta nueva, en ese orden.
        let roles: Vec<&str> = bodies[0]["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["role"].as_str().unwrap())
            .collect();
        assert_eq!(roles, vec!["system", "user", "assistant", "user"]);
        assert_eq!(
            bodies[0]["messages"][1]["content"],
            "Mi número favorito es 7"
        );
        assert_eq!(bodies[0]["messages"][3]["content"], "¿Cuál es?");
        // Anthropic: el sistema va aparte y los mensajes empiezan por el usuario.
        assert_eq!(bodies[1]["system"], "sé breve");
        let roles: Vec<&str> = bodies[1]["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["role"].as_str().unwrap())
            .collect();
        assert_eq!(roles, vec!["user", "assistant", "user"]);
        assert_eq!(bodies[1]["messages"][2]["content"], "¿Cuál es?");
    }

    #[test]
    fn claude_uses_the_anthropic_format() {
        let (base, recorded) = serve(vec![(200, "text/event-stream", ANTHROPIC_STREAM.into())]);
        let client = HttpLlm::new();

        let (result, text) = ask(
            &client,
            &target(ProviderId::Claude, &base, Some("sk-ant-clave")),
        );

        result.unwrap();
        assert_eq!(text, "Canberra");
        let request = recorded.lock().unwrap()[0].clone();
        assert_eq!(request.path, "/v1/messages");
        assert_eq!(request.header("x-api-key"), Some("sk-ant-clave"));
        assert_eq!(request.header("anthropic-version"), Some(ANTHROPIC_VERSION));
        assert_eq!(request.header("authorization"), None);
        let body: Value = serde_json::from_str(&request.body).unwrap();
        assert_eq!(body["system"], "sé breve");
        assert_eq!(body["max_tokens"], 50);
        assert_eq!(body["messages"][0]["content"], "¿Capital de Australia?");
    }

    #[test]
    fn a_rejected_key_a_rate_limit_and_other_errors_have_their_own_error() {
        let (base, _) = serve(vec![
            (
                401,
                "application/json",
                r#"{"error":{"message":"Invalid API Key"}}"#.into(),
            ),
            (429, "application/json", "{}".into()),
            (
                404,
                "application/json",
                r#"{"error":{"message":"The model `x` does not exist"}}"#.into(),
            ),
            (500, "text/plain", "boom".into()),
        ]);
        let client = HttpLlm::new();
        let t = target(ProviderId::Groq, &base, Some("gsk_x"));

        assert_eq!(ask(&client, &t).0.unwrap_err().code(), "ai.unauthorized");
        assert_eq!(ask(&client, &t).0.unwrap_err().code(), "ai.rateLimited");
        let error = ask(&client, &t).0.unwrap_err();
        assert_eq!(error.code(), "ai.provider");
        assert!(error.to_string().contains("does not exist"), "{error}");
        let error = ask(&client, &t).0.unwrap_err();
        assert!(error.to_string().contains("HTTP 500"), "{error}");
    }

    #[test]
    fn an_error_inside_the_stream_is_reported() {
        let stream = "data: {\"error\":{\"message\":\"se cayó\"}}\n\n";
        let (base, _) = serve(vec![(200, "text/event-stream", stream.into())]);
        let (result, _) = ask(&HttpLlm::new(), &target(ProviderId::Groq, &base, Some("k")));
        assert!(result.unwrap_err().to_string().contains("se cayó"));
    }

    #[test]
    fn a_successful_reply_without_any_text_is_a_bad_response() {
        for body in ["data: [DONE]\n\n", "{\"no\":\"es un flujo\"}", ""] {
            let (base, _) = serve(vec![(200, "text/event-stream", body.into())]);
            let (result, text) = ask(&HttpLlm::new(), &target(ProviderId::Groq, &base, Some("k")));
            assert_eq!(result.unwrap_err().code(), "ai.badResponse", "{body:?}");
            assert!(text.is_empty());
        }
    }

    #[test]
    fn a_server_that_is_not_there_is_a_network_error() {
        // Un puerto que acaba de cerrarse.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let (result, _) = ask(
            &HttpLlm::new(),
            &target(
                ProviderId::Ollama,
                &format!("http://127.0.0.1:{port}/v1"),
                None,
            ),
        );
        assert_eq!(result.unwrap_err().code(), "ai.network");
    }

    #[test]
    fn the_answer_can_be_cut_halfway() {
        let (base, _) = serve(vec![(200, "text/event-stream", OPENAI_STREAM.into())]);
        let mut seen = Vec::new();
        let result = HttpLlm::new().stream(
            &target(ProviderId::Groq, &base, Some("k")),
            &Request {
                system: "s",
                history: &[],
                user: "u",
                max_tokens: 5,
            },
            &mut |delta| {
                seen.push(delta.to_string());
                false
            },
        );
        result.unwrap();
        assert_eq!(seen, vec!["Can"]);
    }

    #[test]
    fn lines_are_interpreted_by_format() {
        let openai = |data: &str| parse_line(Wire::OpenAi, data);
        assert_eq!(openai("data: [DONE]"), Line::Done);
        assert_eq!(openai(""), Line::Skip);
        assert_eq!(openai(": comentario"), Line::Skip);
        assert_eq!(openai("data: no es json"), Line::Skip);
        assert_eq!(
            openai(r#"data: {"choices":[{"delta":{"content":null}}]}"#),
            Line::Skip
        );
        assert_eq!(
            openai(r#"data: {"choices":[{"delta":{"content":"hola"}}]}"#),
            Line::Delta("hola".into())
        );

        let anthropic = |data: &str| parse_line(Wire::Anthropic, data);
        assert_eq!(anthropic(r#"data: {"type":"message_stop"}"#), Line::Done);
        assert_eq!(anthropic(r#"data: {"type":"ping"}"#), Line::Skip);
        assert_eq!(
            anthropic(r#"data: {"type":"content_block_delta","delta":{"text":"x"}}"#),
            Line::Delta("x".into())
        );
        assert_eq!(
            anthropic(r#"data: {"type":"error","error":{"message":"mal"}}"#),
            Line::Error("mal".into())
        );
    }

    #[test]
    fn long_provider_messages_are_cut() {
        let long = "x".repeat(1_000);
        let body = format!(r#"{{"error":{{"message":"{long}"}}}}"#);
        let AiError::Provider(message) = http_error(400, &body) else {
            panic!("debía ser Provider");
        };
        assert!(message.len() < 200, "{}", message.len());
    }
}
