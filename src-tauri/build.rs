use std::path::PathBuf;
use std::process::Command;

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    // macOS: `screencapturekit` (captura del audio del sistema) lleva un puente en Swift que busca
    // `@rpath/libswift_Concurrency.dylib`. La crate añade la ruta `/usr/lib/swift` solo a sus
    // propios binarios (las opciones de enlazado de un build.rs no pasan al paquete que la usa),
    // así que Orbit la añade aquí para la app y para los tests. Desde macOS 12 esas librerías
    // de Swift las da el propio sistema.
    if target_os == "macos" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        build_media_library();
    }

    tauri_build::build()
}

/// macOS: compila `orbit_media.m`, la biblioteca con la que perl lee lo que suena y envía las
/// órdenes de música (`src/media/platform/macos.rs`). Hace falta `clang`, que ya trae Xcode Command
/// Line Tools.
fn build_media_library() {
    let source = "src/media/platform/macos/orbit_media.m";
    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").unwrap_or_default());
    let library = out_dir.join("liborbit_media.dylib");
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        _ => "x86_64",
    };

    let status = Command::new("clang")
        .args([
            "-dynamiclib",
            "-O2",
            "-fobjc-arc",
            "-framework",
            "Foundation",
            "-arch",
            arch,
            "-o",
        ])
        .arg(&library)
        .arg(source)
        .status();
    match status {
        Ok(status) if status.success() => {}
        Ok(status) => panic!("clang no pudo compilar {source}: {status}"),
        Err(error) => panic!("no se pudo ejecutar clang (¿Xcode Command Line Tools?): {error}"),
    }

    println!("cargo:rerun-if-changed={source}");
    println!("cargo:rustc-env=ORBIT_MEDIA_DYLIB={}", library.display());
}
