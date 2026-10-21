//! Volcado a WAV (16 bits, mono) SOLO para depuración: se activa con la variable de entorno
//! `ORBIT_DEBUG_WAV=<ruta>`. Por defecto el audio nunca se guarda en disco.

use std::fs::File;
use std::io::{self, BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

const HEADER_LEN: u32 = 44;

pub struct WavWriter {
    out: BufWriter<File>,
    data_bytes: u32,
    finished: bool,
}

impl WavWriter {
    /// Crea el archivo y escribe la cabecera (los tamaños se completan al terminar).
    pub fn create(path: &Path, sample_rate: u32) -> io::Result<Self> {
        let mut out = BufWriter::new(File::create(path)?);
        let channels: u16 = 1;
        let bits: u16 = 16;
        let block_align = channels * bits / 8;

        out.write_all(b"RIFF")?;
        out.write_all(&0_u32.to_le_bytes())?; // tamaño total: se rellena al terminar
        out.write_all(b"WAVEfmt ")?;
        out.write_all(&16_u32.to_le_bytes())?; // tamaño del bloque fmt
        out.write_all(&1_u16.to_le_bytes())?; // PCM
        out.write_all(&channels.to_le_bytes())?;
        out.write_all(&sample_rate.to_le_bytes())?;
        out.write_all(&(sample_rate * u32::from(block_align)).to_le_bytes())?;
        out.write_all(&block_align.to_le_bytes())?;
        out.write_all(&bits.to_le_bytes())?;
        out.write_all(b"data")?;
        out.write_all(&0_u32.to_le_bytes())?; // tamaño de los datos: se rellena al terminar

        Ok(Self {
            out,
            data_bytes: 0,
            finished: false,
        })
    }

    pub fn write(&mut self, samples: &[i16]) -> io::Result<()> {
        for sample in samples {
            self.out.write_all(&sample.to_le_bytes())?;
        }
        let added = u32::try_from(samples.len() * 2).unwrap_or(u32::MAX);
        self.data_bytes = self.data_bytes.saturating_add(added);
        Ok(())
    }

    /// Completa los tamaños de la cabecera y cierra. Se llama sola al soltar el escritor.
    pub fn finish(&mut self) -> io::Result<()> {
        if self.finished {
            return Ok(());
        }
        self.finished = true;
        self.out.flush()?;
        let file = self.out.get_mut();
        file.seek(SeekFrom::Start(4))?;
        file.write_all(&(HEADER_LEN - 8 + self.data_bytes).to_le_bytes())?;
        file.seek(SeekFrom::Start(40))?;
        file.write_all(&self.data_bytes.to_le_bytes())?;
        file.flush()
    }
}

impl Drop for WavWriter {
    fn drop(&mut self) {
        if let Err(error) = self.finish() {
            tracing::warn!(%error, "no se pudo cerrar el WAV de depuración");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("orbit-test-{}-{name}.wav", std::process::id()))
    }

    #[test]
    fn writes_a_valid_header_and_the_samples() {
        let path = temp_path("valid");
        {
            let mut wav = WavWriter::create(&path, 16_000).unwrap();
            wav.write(&[0, 1000, -1000]).unwrap();
            wav.write(&[i16::MAX]).unwrap();
        } // se cierra al soltarlo

        let bytes = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();

        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[12..16], b"fmt ");
        assert_eq!(u16::from_le_bytes([bytes[20], bytes[21]]), 1); // PCM
        assert_eq!(u16::from_le_bytes([bytes[22], bytes[23]]), 1); // mono
        assert_eq!(
            u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
            16_000
        );
        assert_eq!(u16::from_le_bytes([bytes[34], bytes[35]]), 16); // bits
        assert_eq!(&bytes[36..40], b"data");
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 8); // 4 muestras × 2 B
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 36 + 8);
        assert_eq!(bytes.len(), 44 + 8);

        let decoded: Vec<i16> = bytes[44..]
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        assert_eq!(decoded, vec![0, 1000, -1000, i16::MAX]);
    }

    #[test]
    fn an_empty_wav_is_still_valid() {
        let path = temp_path("empty");
        drop(WavWriter::create(&path, 16_000).unwrap());
        let bytes = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(bytes.len(), 44);
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 0);
    }

    #[test]
    fn finish_is_idempotent() {
        let path = temp_path("twice");
        let mut wav = WavWriter::create(&path, 16_000).unwrap();
        wav.write(&[1, 2]).unwrap();
        wav.finish().unwrap();
        wav.finish().unwrap();
        drop(wav);
        let bytes = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(bytes.len(), 44 + 4);
    }
}
