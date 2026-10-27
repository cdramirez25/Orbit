#!/bin/sh
# Instala Orbit en macOS sin pasar por el navegador (así no sale el aviso de "desarrollador no
# verificado"; el archivo no lleva la marca de cuarentena).
#
#   curl -fsSL https://raw.githubusercontent.com/cdramirez25/Orbit/main/install.sh | sh
#
# Variables opcionales:
#   ORBIT_VERSION      versión a instalar (0.1.0); por defecto, la última
#   ORBIT_INSTALL_DIR  carpeta de destino; por defecto /Applications (o ~/Applications si no se puede escribir)
#   ORBIT_DMG          ruta o URL de un .dmg concreto (para pruebas); se salta la búsqueda en GitHub
set -eu

REPO="cdramirez25/Orbit"

case "${LC_ALL:-${LANG:-}}" in
  es*) LANG_ES=1 ;;
  *) LANG_ES=0 ;;
esac

say() { # say "español" "english"
  if [ "$LANG_ES" = 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi
}
fail() {
  say "Error: $1" "Error: $2" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail \
  "este instalador es solo para macOS. En Windows usa Scoop o el instalador de la página de versiones." \
  "this installer is for macOS only. On Windows use Scoop or the installer from the releases page."

case "$(uname -m)" in
  arm64) ARCH="aarch64" ;;
  x86_64) ARCH="x64" ;;
  *) fail "arquitectura no admitida: $(uname -m)" "unsupported architecture: $(uname -m)" ;;
esac

WORK="$(mktemp -d)"
MOUNT="$WORK/mount"
cleanup() {
  hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

if [ -n "${ORBIT_DMG:-}" ]; then
  DMG_SOURCE="$ORBIT_DMG"
  SUMS_URL=""
else
  if [ -n "${ORBIT_VERSION:-}" ]; then
    API="https://api.github.com/repos/$REPO/releases/tags/v${ORBIT_VERSION#v}"
  else
    API="https://api.github.com/repos/$REPO/releases/latest"
  fi
  say "Buscando la versión de Orbit..." "Looking up the Orbit release..."
  RELEASE="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API")" || fail \
    "no se encontró esa versión de Orbit en GitHub." "that Orbit release was not found on GitHub."
  URLS="$(printf '%s\n' "$RELEASE" | sed -n 's/.*"browser_download_url": *"\([^"]*\)".*/\1/p')"
  DMG_SOURCE="$(printf '%s\n' "$URLS" | grep -E "_${ARCH}\.dmg$" | head -n 1 || true)"
  SUMS_URL="$(printf '%s\n' "$URLS" | grep -E '/SHA256SUMS\.txt$' | head -n 1 || true)"
  [ -n "$DMG_SOURCE" ] || fail \
    "esa versión no tiene instalador para este Mac ($ARCH)." \
    "that release has no installer for this Mac ($ARCH)."
fi

DMG="$WORK/Orbit.dmg"
say "Descargando Orbit..." "Downloading Orbit..."
case "$DMG_SOURCE" in
  http://* | https://*) curl -fL --progress-bar -o "$DMG" "$DMG_SOURCE" || fail "la descarga falló." "the download failed." ;;
  *) cp "$DMG_SOURCE" "$DMG" || fail "no se pudo leer $DMG_SOURCE." "could not read $DMG_SOURCE." ;;
esac

if [ -n "$SUMS_URL" ]; then
  EXPECTED="$(curl -fsSL "$SUMS_URL" | grep -E "[ *]$(basename "$DMG_SOURCE")\$" | awk '{print $1}' | head -n 1 || true)"
  ACTUAL="$(shasum -a 256 "$DMG" | awk '{print $1}')"
  if [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$ACTUAL" ]; then
    fail "la descarga está dañada (la huella no coincide)." "the download is corrupted (checksum mismatch)."
  fi
fi

mkdir -p "$MOUNT"
hdiutil attach "$DMG" -nobrowse -readonly -quiet -mountpoint "$MOUNT" || fail \
  "no se pudo abrir el instalador." "could not open the installer image."
[ -d "$MOUNT/Orbit.app" ] || fail "el instalador no trae Orbit.app." "the installer has no Orbit.app."

DEST="${ORBIT_INSTALL_DIR:-/Applications}"
if ! mkdir -p "$DEST" 2>/dev/null || [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

if pgrep -x orbit >/dev/null 2>&1; then
  say "Cerrando Orbit para actualizarlo..." "Quitting Orbit to update it..."
  osascript -e 'tell application "Orbit" to quit' >/dev/null 2>&1 || pkill -x orbit || true
  sleep 1
fi

rm -rf "$DEST/Orbit.app"
ditto "$MOUNT/Orbit.app" "$DEST/Orbit.app"
xattr -dr com.apple.quarantine "$DEST/Orbit.app" 2>/dev/null || true

say "Orbit quedó instalado en $DEST/Orbit.app" "Orbit is installed at $DEST/Orbit.app"
say "Ábrelo con:  open \"$DEST/Orbit.app\"" "Open it with:  open \"$DEST/Orbit.app\""
say "La primera vez, macOS te pedirá permisos (grabación de pantalla para el audio del sistema, cámara) según lo que uses." \
  "The first time, macOS will ask for permissions (screen recording for the system audio, camera) depending on what you use."
