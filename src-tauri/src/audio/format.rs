//! Conversiones puras de formato de muestras (sin APIs del sistema, para poder probarlas).

/// Bytes de muestras `f32` en little-endian (lo que entregan macOS y Windows) → muestras.
/// Los bytes sobrantes que no completan una muestra se ignoran.
pub fn bytes_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Canales separados (uno por plano: LLL… / RRR…) → muestras entrelazadas (L R L R…).
/// Si los planos difieren en largo se usa el más corto.
// Solo lo usa el adaptador de macOS (ScreenCaptureKit entrega un plano por canal).
#[allow(dead_code)]
pub fn interleave_planar(planes: &[&[f32]]) -> Vec<f32> {
    let frames = planes.iter().map(|plane| plane.len()).min().unwrap_or(0);
    let mut out = Vec::with_capacity(frames * planes.len());
    for index in 0..frames {
        for plane in planes {
            out.push(plane[index]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_little_endian_floats() {
        let bytes: Vec<u8> = [0.5_f32, -1.0, 0.25]
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();
        assert_eq!(bytes_to_f32(&bytes), vec![0.5, -1.0, 0.25]);
    }

    #[test]
    fn ignores_a_trailing_partial_sample() {
        let mut bytes: Vec<u8> = 0.5_f32.to_le_bytes().to_vec();
        bytes.extend([1, 2, 3]);
        assert_eq!(bytes_to_f32(&bytes), vec![0.5]);
    }

    #[test]
    fn empty_input_gives_empty_output() {
        assert!(bytes_to_f32(&[]).is_empty());
        assert!(interleave_planar(&[]).is_empty());
    }

    #[test]
    fn interleaves_two_planes() {
        let left = [1.0, 2.0, 3.0];
        let right = [-1.0, -2.0, -3.0];
        assert_eq!(
            interleave_planar(&[&left, &right]),
            vec![1.0, -1.0, 2.0, -2.0, 3.0, -3.0]
        );
    }

    #[test]
    fn uses_the_shortest_plane() {
        let left = [1.0, 2.0, 3.0];
        let right = [-1.0];
        assert_eq!(interleave_planar(&[&left, &right]), vec![1.0, -1.0]);
    }
}
