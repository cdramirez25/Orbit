//! Los modelos de voz que el usuario puede elegir. Son los modelos multilingües de whisper.cpp
//! (MIT, publicados en Hugging Face): el mismo motor con más o menos capacidad.
//!
//! Tamaño y huella SHA-256 salen del listado oficial del repositorio; una descarga que no coincide
//! se descarta (ver `model.rs`).

use serde::{Deserialize, Serialize};

use super::model::Expected;

/// Dónde publica whisper.cpp sus modelos ya convertidos.
const BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SttModel {
    /// Rápido y ligero, pero se equivoca más (sobre todo en español).
    Base,
    /// El equilibrio entre precisión y velocidad; el que se recomienda.
    #[default]
    Small,
    /// Muy preciso, pero grande y lento sin GPU.
    Medium,
    /// `large-v3-turbo` comprimido (q5_0): casi la precisión del modelo grande con el tamaño de uno
    /// pequeño.
    Turbo,
}

impl SttModel {
    /// Todos, de menor a mayor capacidad (el orden en que se muestran).
    pub const ALL: [Self; 4] = [Self::Base, Self::Small, Self::Medium, Self::Turbo];

    /// Nombre del archivo en disco (y en el repositorio).
    pub fn file_name(self) -> &'static str {
        match self {
            Self::Base => "ggml-base.bin",
            Self::Small => "ggml-small.bin",
            Self::Medium => "ggml-medium.bin",
            Self::Turbo => "ggml-large-v3-turbo-q5_0.bin",
        }
    }

    pub fn url(self) -> String {
        format!("{BASE_URL}/{}", self.file_name())
    }

    /// Tamaño y huella con los que se comprueba la descarga.
    pub fn expected(self) -> Expected {
        let (size, sha256) = match self {
            Self::Base => (
                147_951_465,
                "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
            ),
            Self::Small => (
                487_601_967,
                "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
            ),
            Self::Medium => (
                1_533_763_059,
                "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
            ),
            Self::Turbo => (
                574_041_195,
                "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
            ),
        };
        Expected {
            size,
            sha256: sha256.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_is_the_recommended_small_model() {
        assert_eq!(SttModel::default(), SttModel::Small);
        assert_eq!(SttModel::Small.file_name(), "ggml-small.bin");
    }

    #[test]
    fn every_model_has_its_own_file_url_and_checksum() {
        let mut files: Vec<&str> = SttModel::ALL.iter().map(|m| m.file_name()).collect();
        files.sort_unstable();
        files.dedup();
        assert_eq!(files.len(), SttModel::ALL.len(), "dos modelos, un archivo");

        for model in SttModel::ALL {
            let expected = model.expected();
            assert_eq!(expected.sha256.len(), 64, "{model:?}");
            assert!(expected.sha256.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(model.url().ends_with(model.file_name()));
            assert!(model.url().starts_with("https://"));
        }
    }

    #[test]
    fn the_models_grow_in_size_except_the_compressed_turbo() {
        let size = |m: SttModel| m.expected().size;
        assert!(size(SttModel::Base) < size(SttModel::Small));
        assert!(size(SttModel::Small) < size(SttModel::Medium));
        assert!(size(SttModel::Turbo) < size(SttModel::Medium));
    }

    #[test]
    fn the_pinned_small_model_matches_the_one_already_verified_live() {
        assert_eq!(SttModel::Small.expected().size, 487_601_967);
    }

    #[test]
    fn the_wire_format_is_camel_case() {
        assert_eq!(serde_json::to_value(SttModel::Turbo).unwrap(), "turbo");
        assert_eq!(
            serde_json::from_str::<SttModel>("\"medium\"").unwrap(),
            SttModel::Medium
        );
    }
}
