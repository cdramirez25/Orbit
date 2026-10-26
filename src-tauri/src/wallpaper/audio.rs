//! ¿Un video trae pista de sonido? Se lee del propio archivo (sin herramientas externas ni abrirlo en
//! el reproductor): MP4, M4V y MOV (cajas ISO) y WebM (Matroska). Solo se miran los encabezados, que
//! son unos pocos cientos de bytes aunque el video pese gigas.
//!
//! Un archivo raro o cortado nunca da error: da `None` ("no se sabe") y quien llama decide.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Cuántas cajas o elementos hijos se recorren como máximo en un nivel: un archivo corrupto no debe
/// dejar el recorrido dando vueltas.
const MAX_CHILDREN: usize = 4_096;

/// `Some(true)` si el video tiene al menos una pista de audio, `Some(false)` si se leyó y no la
/// tiene, `None` si no se pudo saber (formato no reconocido, archivo cortado o ilegible).
pub fn has_audio(path: &Path) -> Option<bool> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    let mut file = File::open(path).ok()?;
    match extension.as_str() {
        "mp4" | "m4v" | "mov" => mp4_has_audio(&mut file),
        "webm" => webm_has_audio(&mut file),
        _ => None,
    }
}

// ── MP4 / MOV ───────────────────────────────────────────────────────────────────────────────

/// Una caja del archivo: su tipo y dónde empieza y acaba su contenido.
struct Atom {
    kind: [u8; 4],
    start: u64,
    end: u64,
}

fn read_exact_at<R: Read + Seek>(reader: &mut R, at: u64, buffer: &mut [u8]) -> Option<()> {
    reader.seek(SeekFrom::Start(at)).ok()?;
    reader.read_exact(buffer).ok()
}

/// Las cajas que hay entre `start` y `end`, sin entrar en ellas.
fn atoms<R: Read + Seek>(reader: &mut R, start: u64, end: u64) -> Vec<Atom> {
    let mut found = Vec::new();
    let mut at = start;
    while at + 8 <= end && found.len() < MAX_CHILDREN {
        let mut header = [0_u8; 8];
        if read_exact_at(reader, at, &mut header).is_none() {
            break;
        }
        let size32 = u64::from(u32::from_be_bytes([
            header[0], header[1], header[2], header[3],
        ]));
        let kind = [header[4], header[5], header[6], header[7]];
        let (header_len, size) = match size32 {
            // Tamaño de 64 bits justo después del tipo.
            1 => {
                let mut large = [0_u8; 8];
                if read_exact_at(reader, at + 8, &mut large).is_none() {
                    break;
                }
                (16, u64::from_be_bytes(large))
            }
            // La caja llega hasta el final.
            0 => (8, end - at),
            size => (8, size),
        };
        if size < header_len || at + size > end {
            break;
        }
        found.push(Atom {
            kind,
            start: at + header_len,
            end: at + size,
        });
        at += size;
    }
    found
}

fn child<R: Read + Seek>(reader: &mut R, parent: &Atom, kind: &[u8; 4]) -> Option<Atom> {
    atoms(reader, parent.start, parent.end)
        .into_iter()
        .find(|atom| &atom.kind == kind)
}

/// El tipo de una pista (`soun` audio, `vide` video…) según su caja `hdlr`.
fn track_handler<R: Read + Seek>(reader: &mut R, track: &Atom) -> Option<[u8; 4]> {
    let media = child(reader, track, b"mdia")?;
    let handler = child(reader, &media, b"hdlr")?;
    // Versión y banderas (4 bytes), `pre_defined` (4 bytes) y por fin el tipo (4 bytes).
    let mut kind = [0_u8; 4];
    read_exact_at(reader, handler.start + 8, &mut kind)?;
    Some(kind)
}

fn mp4_has_audio<R: Read + Seek>(reader: &mut R) -> Option<bool> {
    let length = reader.seek(SeekFrom::End(0)).ok()?;
    // `moov` puede estar al principio o, en videos grandes sin optimizar, tras todo el contenido:
    // como solo se leen encabezados, saltar el contenido no cuesta nada.
    let moov = atoms(reader, 0, length)
        .into_iter()
        .find(|atom| &atom.kind == b"moov")?;
    let mut tracks = 0;
    for track in atoms(reader, moov.start, moov.end)
        .into_iter()
        .filter(|atom| &atom.kind == b"trak")
    {
        match track_handler(reader, &track) {
            Some(kind) if &kind == b"soun" => return Some(true),
            Some(_) => tracks += 1,
            None => {}
        }
    }
    (tracks > 0).then_some(false)
}

// ── WebM (Matroska) ─────────────────────────────────────────────────────────────────────────

const ID_EBML: u64 = 0x1A45_DFA3;
const ID_SEGMENT: u64 = 0x1853_8067;
const ID_TRACKS: u64 = 0x1654_AE6B;
const ID_TRACK_ENTRY: u64 = 0xAE;
const ID_TRACK_TYPE: u64 = 0x83;
const ID_CLUSTER: u64 = 0x1F43_B675;
/// Valor de `TrackType` de una pista de audio.
const TRACK_TYPE_AUDIO: u64 = 2;

/// Lee un identificador de elemento (de 1 a 4 bytes; el marcador de longitud forma parte del valor).
fn read_id<R: Read>(reader: &mut R) -> Option<(u64, u64)> {
    let mut first = [0_u8; 1];
    reader.read_exact(&mut first).ok()?;
    let length = first[0].leading_zeros() as usize + 1;
    if length > 4 {
        return None;
    }
    let mut value = u64::from(first[0]);
    for _ in 1..length {
        let mut next = [0_u8; 1];
        reader.read_exact(&mut next).ok()?;
        value = (value << 8) | u64::from(next[0]);
    }
    Some((value, length as u64))
}

/// Lee un tamaño de elemento (entero de longitud variable). `None` dentro del `Some` = tamaño
/// desconocido (el archivo se grabó en directo).
fn read_size<R: Read>(reader: &mut R) -> Option<(Option<u64>, u64)> {
    let mut first = [0_u8; 1];
    reader.read_exact(&mut first).ok()?;
    let length = first[0].leading_zeros() as usize + 1;
    if length > 8 {
        return None;
    }
    let mask = if length == 8 { 0 } else { 0xFF_u8 >> length };
    let mut value = u64::from(first[0] & mask);
    let mut all_ones = (first[0] & mask) == mask;
    for _ in 1..length {
        let mut next = [0_u8; 1];
        reader.read_exact(&mut next).ok()?;
        all_ones &= next[0] == 0xFF;
        value = (value << 8) | u64::from(next[0]);
    }
    Some(((!all_ones).then_some(value), length as u64))
}

/// Un elemento: su identificador, dónde empieza su contenido y dónde acaba (`None` = no se sabe).
struct Element {
    id: u64,
    start: u64,
    end: Option<u64>,
}

fn read_element<R: Read + Seek>(reader: &mut R, at: u64) -> Option<Element> {
    reader.seek(SeekFrom::Start(at)).ok()?;
    let (id, id_length) = read_id(reader)?;
    let (size, size_length) = read_size(reader)?;
    let start = at + id_length + size_length;
    Some(Element {
        id,
        start,
        end: size.map(|size| start + size),
    })
}

/// Un número sin signo guardado en `length` bytes (hasta 8).
fn read_uint<R: Read + Seek>(reader: &mut R, at: u64, length: u64) -> Option<u64> {
    if !(1..=8).contains(&length) {
        return None;
    }
    let mut bytes = vec![0_u8; length as usize];
    read_exact_at(reader, at, &mut bytes)?;
    Some(
        bytes
            .iter()
            .fold(0, |value, byte| (value << 8) | u64::from(*byte)),
    )
}

/// ¿Alguna pista de ese elemento `Tracks` es de audio?
fn tracks_have_audio<R: Read + Seek>(reader: &mut R, tracks: &Element, limit: u64) -> Option<bool> {
    let end = tracks.end.unwrap_or(limit).min(limit);
    let mut at = tracks.start;
    let mut entries = 0;
    while at < end && entries < MAX_CHILDREN {
        let entry = read_element(reader, at)?;
        let entry_end = entry.end?.min(end);
        if entry.id == ID_TRACK_ENTRY {
            entries += 1;
            let mut inner = entry.start;
            let mut guard = 0;
            while inner < entry_end && guard < MAX_CHILDREN {
                guard += 1;
                let field = read_element(reader, inner)?;
                let field_end = field.end?;
                if field.id == ID_TRACK_TYPE
                    && read_uint(reader, field.start, field_end - field.start)
                        == Some(TRACK_TYPE_AUDIO)
                {
                    return Some(true);
                }
                inner = field_end;
            }
        }
        at = entry_end;
    }
    (entries > 0).then_some(false)
}

fn webm_has_audio<R: Read + Seek>(reader: &mut R) -> Option<bool> {
    let length = reader.seek(SeekFrom::End(0)).ok()?;
    let mut at = 0;
    for _ in 0..MAX_CHILDREN {
        if at >= length {
            return None;
        }
        let top = read_element(reader, at)?;
        match top.id {
            ID_SEGMENT => return segment_has_audio(reader, &top, length),
            ID_EBML => at = top.end?,
            _ => return None,
        }
    }
    None
}

fn segment_has_audio<R: Read + Seek>(
    reader: &mut R,
    segment: &Element,
    length: u64,
) -> Option<bool> {
    let end = segment.end.unwrap_or(length).min(length);
    let mut at = segment.start;
    for _ in 0..MAX_CHILDREN {
        if at >= end {
            return None;
        }
        let element = read_element(reader, at)?;
        match element.id {
            ID_TRACKS => return tracks_have_audio(reader, &element, end),
            // Llegó el contenido sin que antes hubiera pistas: no se sabe.
            ID_CLUSTER => return None,
            _ => at = element.end?,
        }
    }
    None
}

/// Un MP4 mínimo, con o sin pista de sonido, para las pruebas de otros módulos.
#[cfg(test)]
pub(crate) fn sample_mp4(with_audio: bool) -> Vec<u8> {
    fn atom(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut bytes = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(payload);
        bytes
    }
    fn track(handler: &[u8; 4]) -> Vec<u8> {
        let mut payload = vec![0_u8; 8];
        payload.extend_from_slice(handler);
        payload.extend_from_slice(&[0_u8; 12]);
        atom(b"trak", &atom(b"mdia", &atom(b"hdlr", &payload)))
    }
    let mut tracks = track(b"vide");
    if with_audio {
        tracks.extend(track(b"soun"));
    }
    let mut file = atom(b"ftyp", b"isom\0\0\0\0isom");
    file.extend(atom(b"moov", &tracks));
    file
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    // ── MP4 ─────────────────────────────────────────────────────────────────────────────────

    fn atom(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut bytes = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(payload);
        bytes
    }

    fn handler(kind: &[u8; 4]) -> Vec<u8> {
        let mut payload = vec![0_u8; 8]; // versión, banderas y `pre_defined`
        payload.extend_from_slice(kind);
        payload.extend_from_slice(&[0_u8; 12]);
        atom(b"hdlr", &payload)
    }

    fn track(kind: &[u8; 4]) -> Vec<u8> {
        atom(b"trak", &atom(b"mdia", &handler(kind)))
    }

    fn moov(tracks: &[Vec<u8>]) -> Vec<u8> {
        atom(b"moov", &tracks.concat())
    }

    fn mp4(parts: &[Vec<u8>]) -> Vec<u8> {
        let mut file = atom(b"ftyp", b"isom\0\0\0\0isom");
        for part in parts {
            file.extend_from_slice(part);
        }
        file
    }

    fn mp4_audio(bytes: Vec<u8>) -> Option<bool> {
        mp4_has_audio(&mut Cursor::new(bytes))
    }

    #[test]
    fn an_mp4_with_a_sound_track_has_audio() {
        let file = mp4(&[moov(&[track(b"vide"), track(b"soun")])]);
        assert_eq!(mp4_audio(file), Some(true));
    }

    #[test]
    fn an_mp4_with_only_video_has_no_audio() {
        let file = mp4(&[moov(&[track(b"vide")])]);
        assert_eq!(mp4_audio(file), Some(false));
    }

    #[test]
    fn the_sound_track_can_come_first() {
        let file = mp4(&[moov(&[track(b"soun"), track(b"vide")])]);
        assert_eq!(mp4_audio(file), Some(true));
    }

    #[test]
    fn moov_after_a_big_mdat_is_found_by_skipping_the_content() {
        let content = vec![0_u8; 200_000];
        let file = mp4(&[
            atom(b"mdat", &content),
            moov(&[track(b"vide"), track(b"soun")]),
        ]);
        assert_eq!(mp4_audio(file), Some(true));
    }

    #[test]
    fn an_atom_with_a_64_bit_size_is_understood() {
        let inner = moov(&[track(b"vide")]);
        let mut large = 1_u32.to_be_bytes().to_vec();
        large.extend_from_slice(b"free");
        large.extend_from_slice(&((16 + 4) as u64).to_be_bytes());
        large.extend_from_slice(&[0, 0, 0, 0]);
        let file = mp4(&[large, inner]);
        assert_eq!(mp4_audio(file), Some(false));
    }

    #[test]
    fn a_file_without_moov_or_without_tracks_is_unknown() {
        assert_eq!(mp4_audio(mp4(&[atom(b"mdat", b"datos")])), None);
        assert_eq!(mp4_audio(mp4(&[moov(&[])])), None);
        assert_eq!(mp4_audio(Vec::new()), None);
        assert_eq!(mp4_audio(b"esto no es un video".to_vec()), None);
    }

    #[test]
    fn a_truncated_mp4_never_panics_or_loops() {
        let file = mp4(&[
            atom(b"mdat", &[1, 2, 3]),
            moov(&[track(b"vide"), track(b"soun")]),
        ]);
        for length in 0..file.len() {
            let _ = mp4_audio(file[..length].to_vec());
        }
    }

    #[test]
    fn an_atom_that_claims_more_than_the_file_has_is_ignored() {
        let mut file = mp4(&[]);
        file.extend_from_slice(&u32::MAX.to_be_bytes());
        file.extend_from_slice(b"moov");
        assert_eq!(mp4_audio(file), None);
    }

    // ── WebM ────────────────────────────────────────────────────────────────────────────────

    /// Un elemento EBML con su identificador (ya con sus bytes) y un tamaño de 4 bytes.
    fn element(id: &[u8], payload: &[u8]) -> Vec<u8> {
        let mut bytes = id.to_vec();
        let size = payload.len() as u32;
        bytes.extend_from_slice(&[
            0x10 | (size >> 24) as u8,
            (size >> 16) as u8,
            (size >> 8) as u8,
            size as u8,
        ]);
        bytes.extend_from_slice(payload);
        bytes
    }

    fn track_entry(kind: u8) -> Vec<u8> {
        element(&[0xAE], &element(&[0x83], &[kind]))
    }

    fn tracks(entries: &[Vec<u8>]) -> Vec<u8> {
        element(&[0x16, 0x54, 0xAE, 0x6B], &entries.concat())
    }

    fn webm(segment_children: &[Vec<u8>]) -> Vec<u8> {
        let mut file = element(&[0x1A, 0x45, 0xDF, 0xA3], &element(&[0x42, 0x82], b"webm"));
        file.extend_from_slice(&element(
            &[0x18, 0x53, 0x80, 0x67],
            &segment_children.concat(),
        ));
        file
    }

    fn webm_audio(bytes: Vec<u8>) -> Option<bool> {
        webm_has_audio(&mut Cursor::new(bytes))
    }

    #[test]
    fn a_webm_with_an_audio_track_has_audio() {
        let file = webm(&[tracks(&[track_entry(1), track_entry(2)])]);
        assert_eq!(webm_audio(file), Some(true));
    }

    #[test]
    fn a_webm_with_only_video_has_no_audio() {
        let file = webm(&[tracks(&[track_entry(1)])]);
        assert_eq!(webm_audio(file), Some(false));
    }

    #[test]
    fn other_elements_before_the_tracks_are_skipped() {
        let seek_head = element(&[0x11, 0x4D, 0x9B, 0x74], &[0, 0, 0, 0]);
        let info = element(&[0x15, 0x49, 0xA9, 0x66], &[1, 2, 3]);
        let file = webm(&[seek_head, info, tracks(&[track_entry(1), track_entry(2)])]);
        assert_eq!(webm_audio(file), Some(true));
    }

    #[test]
    fn media_before_any_tracks_is_unknown() {
        let cluster = element(&[0x1F, 0x43, 0xB6, 0x75], &[0, 0]);
        assert_eq!(webm_audio(webm(&[cluster])), None);
    }

    #[test]
    fn a_segment_of_unknown_size_is_read_until_the_end() {
        let mut file = element(&[0x1A, 0x45, 0xDF, 0xA3], &element(&[0x42, 0x82], b"webm"));
        file.extend_from_slice(&[
            0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        ]);
        file.extend_from_slice(&tracks(&[track_entry(1), track_entry(2)]));
        assert_eq!(webm_audio(file), Some(true));
    }

    #[test]
    fn garbage_and_truncated_webm_are_unknown_and_never_loop() {
        assert_eq!(webm_audio(Vec::new()), None);
        assert_eq!(webm_audio(b"no es un webm".to_vec()), None);
        let file = webm(&[tracks(&[track_entry(1), track_entry(2)])]);
        for length in 0..file.len() {
            let _ = webm_audio(file[..length].to_vec());
        }
    }

    // ── por extensión ───────────────────────────────────────────────────────────────────────

    #[test]
    fn the_file_extension_decides_the_format_and_other_types_are_unknown() {
        let dir = std::env::temp_dir().join(format!("orbit-audio-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let with = dir.join("con.MP4");
        let without = dir.join("sin.mov");
        let sound = dir.join("con.webm");
        let image = dir.join("foto.png");
        std::fs::write(&with, mp4(&[moov(&[track(b"vide"), track(b"soun")])])).unwrap();
        std::fs::write(&without, mp4(&[moov(&[track(b"vide")])])).unwrap();
        std::fs::write(&sound, webm(&[tracks(&[track_entry(2)])])).unwrap();
        std::fs::write(&image, b"png").unwrap();

        assert_eq!(has_audio(&with), Some(true));
        assert_eq!(has_audio(&without), Some(false));
        assert_eq!(has_audio(&sound), Some(true));
        assert_eq!(has_audio(&image), None);
        assert_eq!(has_audio(&dir.join("no-existe.mp4")), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Archivos de verdad hechos con ffmpeg, en la carpeta de `ORBIT_TEST_VIDEO_DIR`: `con-audio.mp4`,
    /// `sin-audio.mp4`, `con-audio.webm` y `sin-audio.webm`. Manual.
    ///
    /// ```text
    /// ORBIT_TEST_VIDEO_DIR=/tmp/videos cargo test live_detects_audio -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "necesita videos reales en ORBIT_TEST_VIDEO_DIR"]
    fn live_detects_audio_in_real_files() {
        let dir =
            std::path::PathBuf::from(std::env::var("ORBIT_TEST_VIDEO_DIR").unwrap_or_default());
        for (name, expected) in [
            ("con-audio.mp4", Some(true)),
            ("sin-audio.mp4", Some(false)),
            ("con-audio.webm", Some(true)),
            ("sin-audio.webm", Some(false)),
        ] {
            println!("{name}: {:?}", has_audio(&dir.join(name)));
            assert_eq!(has_audio(&dir.join(name)), expected, "{name}");
        }
    }
}
