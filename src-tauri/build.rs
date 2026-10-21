fn main() {
    // macOS: `screencapturekit` (captura del audio del sistema) lleva un puente en Swift que busca
    // `@rpath/libswift_Concurrency.dylib`. La crate añade la ruta `/usr/lib/swift` solo a sus
    // propios binarios (las opciones de enlazado de un build.rs no pasan al paquete que la usa),
    // así que Orbit la añade aquí para la app y para los tests. Desde macOS 12 esas librerías
    // de Swift las da el propio sistema.
    if std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }

    tauri_build::build()
}
