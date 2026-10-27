# Publicar una versión de Orbit

Orbit se reparte gratis y sin cuenta de Apple Developer ni certificado de Windows. Todo lo hace el
workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml); aquí está lo que hay que
hacer a mano y lo que hay que saber.

## Publicar

1. Sube la misma versión (`X.Y.Z`) a `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`.
2. Haz el commit y súbelo a `main`.
3. Crea y sube la etiqueta:

   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

El workflow compila macOS (Apple Silicon e Intel) y Windows, sube los instaladores a una versión marcada
como pre-lanzamiento y, si todo salió bien, calcula las huellas (`SHA256SUMS.txt`), actualiza el cask de
Homebrew (`Casks/orbit.rb`) y el bucket de Scoop (`bucket/orbit.json`) en `main` y marca la versión
como la última. Si un paso falla, la versión se queda como pre-lanzamiento y nadie la recibe.

Para probar la compilación sin publicar nada: pestaña Actions, `release`, Run workflow. Los instaladores
quedan como artefactos de esa ejecución.

## Qué se publica

| Archivo                        | Para qué                                            |
| ------------------------------ | --------------------------------------------------- |
| `Orbit_X.Y.Z_aarch64.dmg`      | macOS con Apple Silicon                             |
| `Orbit_X.Y.Z_x64.dmg`          | macOS con Intel                                     |
| `Orbit_X.Y.Z_x64-setup.exe`    | Windows, instalador (sin permisos de administrador) |
| `Orbit_X.Y.Z_x64_en-US.msi`    | Windows, instalador MSI                             |
| `Orbit_X.Y.Z_x64-portable.zip` | Windows, `Orbit.exe` suelto (lo usa Scoop)          |
| `SHA256SUMS.txt`               | huellas de todo lo anterior                         |

## Cómo se instala (para el README)

- **macOS, script:** `curl -fsSL https://raw.githubusercontent.com/cdramirez25/Orbit/main/install.sh | sh`.
  Lo que baja `curl` no lleva la marca de cuarentena, así que no sale el aviso de Gatekeeper.
- **macOS, Homebrew:** `brew tap cdramirez25/orbit https://github.com/cdramirez25/Orbit` y
  `brew install --cask orbit`.
- **macOS, dmg a mano:** como la app no está notarizada, macOS dice que no puede verificarla. Hay que
  abrir Ajustes del Sistema, Privacidad y seguridad, y pulsar "Abrir de todos modos".
- **Windows, Scoop:** `scoop bucket add orbit https://github.com/cdramirez25/Orbit` y
  `scoop install orbit/orbit`.
- **Windows, instalador:** SmartScreen avisa ("Windows protegió tu PC"): "Más información" y
  "Ejecutar de todas formas".

## winget (pendiente de la primera versión)

winget no se puede automatizar del todo: el primer envío es un PR a
[`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs) que revisan personas.

1. Con la primera versión ya publicada: `winget install wingetcreate`, y
   `wingetcreate new https://github.com/cdramirez25/Orbit/releases/download/vX.Y.Z/Orbit_X.Y.Z_x64-setup.exe`.
   Identificador sugerido: `CristianRamirez.Orbit`.
2. Las versiones siguientes se pueden enviar con `wingetcreate update` o con la acción
   `vedantmgoyal9/winget-releaser` (necesita un token personal guardado como secreto del repositorio).

## Limitaciones conocidas

- **No hay notarización gratis.** Quitar todos los avisos de macOS exige la cuenta de pago (99 USD/año).
- **Firma ad-hoc:** la app va firmada con la identidad "-" (sin cuenta). macOS puede volver a pedir el
  permiso de Grabación de pantalla al actualizar, porque el permiso va ligado a la firma.
- **Homebrew oficial no la acepta** (exige apps firmadas y notarizadas): por eso el tap propio. Si
  Homebrew endurece las reglas de los taps de terceros, queda el script de instalación.
- **Mac App Store:** no es posible (usamos APIs privadas de música y el permiso de grabación de pantalla).
- **Firma gratis en Windows:** [SignPath Foundation](https://signpath.org) la da a proyectos con licencia
  de código abierto aprobada por la OSI. Orbit todavía no tiene licencia: sin ella el código es, por
  defecto, de derechos reservados.
