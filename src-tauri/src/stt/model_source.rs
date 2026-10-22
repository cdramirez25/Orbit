//! Adaptador de red del modelo: lo baja de Hugging Face (donde whisper.cpp publica los modelos).
//! Usa el TLS del sistema operativo, igual que el resto de clientes HTTP de la app.

use std::time::Duration;

use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::Agent;

use super::catalog::SttModel;
use super::model::{Download, ModelError, ModelSource};

const USER_AGENT: &str = concat!("Orbit/", env!("CARGO_PKG_VERSION"));
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);
/// Tope de toda la descarga (el modelo más grande pesa ≈ 1,5 GB): una conexión colgada no puede
/// dejarla abierta para siempre.
const BODY_TIMEOUT: Duration = Duration::from_secs(60 * 60);

pub struct HttpModelSource {
    agent: Agent,
    url: String,
}

impl HttpModelSource {
    /// La fuente de un modelo del catálogo (Hugging Face).
    pub fn for_model(model: SttModel) -> Self {
        Self::with_url(&model.url())
    }

    pub fn with_url(url: &str) -> Self {
        let tls = TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(RootCerts::PlatformVerifier)
            .build();
        let config = Agent::config_builder()
            .tls_config(tls)
            .user_agent(USER_AGENT)
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_recv_response(Some(RESPONSE_TIMEOUT))
            .timeout_recv_body(Some(BODY_TIMEOUT))
            .build();
        Self {
            agent: Agent::new_with_config(config),
            url: url.to_owned(),
        }
    }
}

impl ModelSource for HttpModelSource {
    fn open(&self, from: u64) -> Result<Download, ModelError> {
        let mut request = self.agent.get(&self.url);
        if from > 0 {
            request = request.header("Range", format!("bytes={from}-"));
        }
        let response = request
            .call()
            .map_err(|error| ModelError::Network(error.to_string()))?;
        // Si se pidió a partir de un byte, el servidor tiene que contestar solo con el resto (206):
        // un 200 traería el archivo entero otra vez y duplicaría lo ya guardado.
        if from > 0 && response.status().as_u16() != 206 {
            return Err(ModelError::Network(
                "el servidor no permite reanudar la descarga".into(),
            ));
        }
        let remaining = response.body().content_length().unwrap_or(0);
        Ok(Download {
            total: from + remaining,
            reader: Box::new(response.into_body().into_reader()),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::Arc;

    use super::*;
    use crate::events::testing::FakeEventSink;
    use crate::stt::location::ModelLocation;
    use crate::stt::model::{ModelService, ModelSpec, ModelState};

    /// Servidor HTTP local que contesta una sola petición con `status` y `body`. Con
    /// `honor_range`, una petición con `Range: bytes=N-` recibe un 206 con el resto del cuerpo.
    fn serve_once(status: &str, body: Vec<u8>, honor_range: bool) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_owned();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request = [0_u8; 1024];
                let read = stream.read(&mut request).unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..read]).to_lowercase();
                let from = request
                    .split("range: bytes=")
                    .nth(1)
                    .and_then(|rest| rest.split('-').next())
                    .and_then(|number| number.parse::<usize>().ok())
                    .filter(|_| honor_range);
                let (status, body) = match from {
                    Some(from) => ("206 Partial Content".to_owned(), body[from..].to_vec()),
                    None => (status, body),
                };
                let head = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&body);
            }
        });
        format!("http://{address}/model.bin")
    }

    #[test]
    fn it_streams_the_body_and_reports_its_size() {
        let url = serve_once("200 OK", b"hello model".to_vec(), false);
        let download = HttpModelSource::with_url(&url).open(0).unwrap();

        assert_eq!(download.total, 11);
        let mut text = String::new();
        let mut reader = download.reader;
        reader.read_to_string(&mut text).unwrap();
        assert_eq!(text, "hello model");
    }

    #[test]
    fn it_resumes_from_a_byte_and_reports_the_full_size() {
        let url = serve_once("200 OK", b"hello model".to_vec(), true);
        let download = HttpModelSource::with_url(&url).open(6).unwrap();

        assert_eq!(download.total, 11, "el tamaño completo, no solo el resto");
        let mut text = String::new();
        let mut reader = download.reader;
        reader.read_to_string(&mut text).unwrap();
        assert_eq!(text, "model");
    }

    #[test]
    fn a_server_that_ignores_the_range_is_not_trusted_to_resume() {
        let url = serve_once("200 OK", b"hello model".to_vec(), false);
        let error = HttpModelSource::with_url(&url).open(6).err().unwrap();
        assert_eq!(error.code(), "stt.model.network");
    }

    #[test]
    fn an_error_status_is_a_network_error() {
        let url = serve_once("404 Not Found", b"nope".to_vec(), false);
        let error = HttpModelSource::with_url(&url).open(0).err().unwrap();
        assert_eq!(error.code(), "stt.model.network");
    }

    #[test]
    fn a_server_that_is_not_there_is_a_network_error() {
        let error = HttpModelSource::with_url("http://127.0.0.1:1/model.bin")
            .open(0)
            .err()
            .unwrap();
        assert_eq!(error.code(), "stt.model.network");
    }

    /// Descarga modelos reales a una carpeta temporal y comprueba su huella. Manual. Los modelos
    /// son los de `ORBIT_TEST_STT_MODELS` (separados por comas: `base,small,medium,turbo`); por
    /// defecto solo `base`, el más pequeño (≈ 140 MB).
    ///
    /// ```text
    /// ORBIT_TEST_STT_MODELS=base,small,medium,turbo \
    ///   cargo test live_downloads_the_real_models -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "descarga modelos reales de Hugging Face"]
    fn live_downloads_the_real_models() {
        let wanted = std::env::var("ORBIT_TEST_STT_MODELS").unwrap_or_else(|_| "base".into());
        let dir: PathBuf =
            std::env::temp_dir().join(format!("orbit-live-model-{}", std::process::id()));
        let specs = SttModel::ALL
            .iter()
            .map(|&model| ModelSpec {
                model,
                expected: model.expected(),
                source: Arc::new(HttpModelSource::for_model(model)),
            })
            .collect();
        let service = Arc::new(ModelService::new(
            Arc::new(ModelLocation::new(dir.clone(), None, SttModel::Small)),
            specs,
            Arc::new(FakeEventSink::default()),
        ));

        for name in wanted.split(',') {
            let model = match name.trim() {
                "base" => SttModel::Base,
                "small" => SttModel::Small,
                "medium" => SttModel::Medium,
                "turbo" => SttModel::Turbo,
                other => panic!("modelo desconocido: {other}"),
            };
            let started = std::time::Instant::now();
            assert!(service.download_blocking(model), "{model:?} no se bajó");
            println!("{model:?}: {} s", started.elapsed().as_secs());

            let entry = service
                .status()
                .models
                .into_iter()
                .find(|entry| entry.model == model)
                .unwrap();
            assert_eq!(entry.error, None);
            assert_eq!(entry.state, ModelState::Ready);
            let size = std::fs::metadata(dir.join(model.file_name()))
                .unwrap()
                .len();
            assert_eq!(size, model.expected().size);
            // Se borra en cuanto se comprueba: los grandes ocupan GB.
            service.remove(model).unwrap();
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
