//! Imágenes del portapapeles: codificar/decodificar PNG, huella para detectar repetidas y
//! miniaturas. Lógica pura, sin APIs del sistema.

use std::io::Cursor;

/// Imagen en bruto: píxeles RGBA de 8 bits por canal, fila a fila.
#[derive(Debug, Clone, PartialEq)]
pub struct RgbaImage {
    pub width: usize,
    pub height: usize,
    pub rgba: Vec<u8>,
}

impl RgbaImage {
    /// `true` si las dimensiones y el número de bytes cuadran.
    pub fn is_valid(&self) -> bool {
        self.width > 0
            && self.height > 0
            && self
                .width
                .checked_mul(self.height)
                .and_then(|p| p.checked_mul(4))
                == Some(self.rgba.len())
    }

    /// Huella (FNV-1a de 64 bits) de las dimensiones y los píxeles: sirve para saber si dos
    /// imágenes son iguales sin compararlas byte a byte ni guardar la original.
    pub fn fingerprint(&self) -> u64 {
        const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
        const PRIME: u64 = 0x0000_0100_0000_01b3;
        let mut hash = OFFSET;
        let mut feed = |byte: u8| {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(PRIME);
        };
        for byte in (self.width as u64).to_le_bytes() {
            feed(byte);
        }
        for byte in (self.height as u64).to_le_bytes() {
            feed(byte);
        }
        for byte in &self.rgba {
            feed(*byte);
        }
        hash
    }
}

/// RGBA → PNG (compresión rápida: se codifica en el hilo del monitor sin retrasarlo).
pub fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    if !image.is_valid() {
        return Err("dimensiones inválidas".to_string());
    }
    let width = u32::try_from(image.width).map_err(|_| "imagen demasiado ancha".to_string())?;
    let height = u32::try_from(image.height).map_err(|_| "imagen demasiado alta".to_string())?;

    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer
        .write_image_data(&image.rgba)
        .map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(out)
}

/// PNG (el que generó `encode_png`) → RGBA.
pub fn decode_png(bytes: &[u8]) -> Result<RgbaImage, String> {
    let mut reader = png::Decoder::new(Cursor::new(bytes))
        .read_info()
        .map_err(|e| e.to_string())?;
    let mut buffer = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("imagen demasiado grande")?
    ];
    let info = reader.next_frame(&mut buffer).map_err(|e| e.to_string())?;
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return Err("formato PNG inesperado".to_string());
    }
    buffer.truncate(info.buffer_size());
    Ok(RgbaImage {
        width: info.width as usize,
        height: info.height as usize,
        rgba: buffer,
    })
}

/// Reduce la imagen para que su lado mayor mida como mucho `max_side` píxeles, promediando
/// los píxeles de origen que caen en cada píxel nuevo (filtro de caja). Si ya cabe, la deja igual.
pub fn thumbnail(image: &RgbaImage, max_side: usize) -> RgbaImage {
    let longest = image.width.max(image.height);
    if !image.is_valid() || max_side == 0 || longest <= max_side {
        return image.clone();
    }

    let new_width = (image.width * max_side / longest).max(1);
    let new_height = (image.height * max_side / longest).max(1);
    let mut rgba = Vec::with_capacity(new_width * new_height * 4);

    for y in 0..new_height {
        let y0 = y * image.height / new_height;
        let y1 = (((y + 1) * image.height).div_ceil(new_height)).clamp(y0 + 1, image.height);
        for x in 0..new_width {
            let x0 = x * image.width / new_width;
            let x1 = (((x + 1) * image.width).div_ceil(new_width)).clamp(x0 + 1, image.width);

            let mut sum = [0_u64; 4];
            for sy in y0..y1 {
                let row = sy * image.width * 4;
                for sx in x0..x1 {
                    let pixel = row + sx * 4;
                    for (channel, total) in sum.iter_mut().enumerate() {
                        *total += u64::from(image.rgba[pixel + channel]);
                    }
                }
            }
            let count = ((y1 - y0) * (x1 - x0)) as u64;
            for total in sum {
                rgba.push(((total + count / 2) / count) as u8);
            }
        }
    }

    RgbaImage {
        width: new_width,
        height: new_height,
        rgba,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: usize, height: usize, pixel: [u8; 4]) -> RgbaImage {
        RgbaImage {
            width,
            height,
            rgba: pixel.repeat(width * height),
        }
    }

    /// Degradado determinista para detectar cualquier píxel que cambie.
    fn gradient(width: usize, height: usize) -> RgbaImage {
        let mut rgba = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            for x in 0..width {
                rgba.extend([
                    (x * 7 % 256) as u8,
                    (y * 13 % 256) as u8,
                    ((x + y) % 256) as u8,
                    255,
                ]);
            }
        }
        RgbaImage {
            width,
            height,
            rgba,
        }
    }

    #[test]
    fn png_roundtrip_is_lossless() {
        let image = gradient(37, 23);
        let png = encode_png(&image).unwrap();
        assert_eq!(&png[1..4], b"PNG");
        assert_eq!(decode_png(&png).unwrap(), image);
    }

    #[test]
    fn png_roundtrip_keeps_transparency() {
        let mut image = solid(4, 4, [10, 20, 30, 0]);
        image.rgba[3] = 128;
        assert_eq!(decode_png(&encode_png(&image).unwrap()).unwrap(), image);
    }

    #[test]
    fn invalid_images_are_rejected() {
        let bad = RgbaImage {
            width: 3,
            height: 3,
            rgba: vec![0; 10],
        };
        assert!(!bad.is_valid());
        assert!(encode_png(&bad).is_err());
        assert!(encode_png(&solid(0, 5, [0; 4])).is_err());
        assert!(decode_png(b"esto no es un png").is_err());
    }

    #[test]
    fn the_fingerprint_separates_different_images_and_matches_equal_ones() {
        let a = gradient(16, 16);
        assert_eq!(a.fingerprint(), a.clone().fingerprint());

        let mut changed = a.clone();
        changed.rgba[100] ^= 1; // un solo bit
        assert_ne!(a.fingerprint(), changed.fingerprint());

        // Mismos bytes pero otra forma: 16x4 frente a 8x8.
        let wide = solid(16, 4, [9, 9, 9, 255]);
        let square = solid(8, 8, [9, 9, 9, 255]);
        assert_ne!(wide.fingerprint(), square.fingerprint());
    }

    #[test]
    fn thumbnails_keep_the_aspect_ratio_and_the_size_limit() {
        let thumb = thumbnail(&solid(1000, 500, [1, 2, 3, 255]), 160);
        assert_eq!((thumb.width, thumb.height), (160, 80));
        assert!(thumb.is_valid());

        let tall = thumbnail(&solid(300, 900, [1, 2, 3, 255]), 160);
        assert_eq!((tall.width, tall.height), (53, 160));
    }

    #[test]
    fn small_images_are_not_enlarged() {
        let small = gradient(40, 30);
        assert_eq!(thumbnail(&small, 160), small);
    }

    #[test]
    fn thumbnails_average_the_pixels() {
        // Mitad izquierda negra y mitad derecha blanca → al reducir 2x en horizontal
        // los dos píxeles resultantes siguen siendo negro y blanco.
        let mut image = solid(4, 2, [0, 0, 0, 255]);
        for y in 0..2 {
            for x in 2..4 {
                let i = (y * 4 + x) * 4;
                image.rgba[i..i + 4].copy_from_slice(&[255, 255, 255, 255]);
            }
        }
        let thumb = thumbnail(&image, 2);
        assert_eq!((thumb.width, thumb.height), (2, 1));
        assert_eq!(&thumb.rgba[0..4], &[0, 0, 0, 255]);
        assert_eq!(&thumb.rgba[4..8], &[255, 255, 255, 255]);

        // Un damero fino se promedia a gris.
        let mut checker = solid(2, 2, [0, 0, 0, 255]);
        for i in [0, 3] {
            checker.rgba[i * 4..i * 4 + 4].copy_from_slice(&[200, 200, 200, 255]);
        }
        let gray = thumbnail(&checker, 1);
        assert_eq!((gray.width, gray.height), (1, 1));
        assert_eq!(gray.rgba[0], 100);
    }

    #[test]
    fn extreme_aspect_ratios_never_collapse_to_zero() {
        let thumb = thumbnail(&solid(5000, 3, [5, 5, 5, 255]), 100);
        assert_eq!(thumb.width, 100);
        assert_eq!(thumb.height, 1);
        assert!(thumb.is_valid());
    }
}
