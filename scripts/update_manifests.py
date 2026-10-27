#!/usr/bin/env python3
"""Escribe los manifiestos de instalación (cask de Homebrew y bucket de Scoop) de una versión de Orbit
a partir de los archivos que subió el workflow de publicación y sus huellas SHA-256.

    python3 scripts/update_manifests.py --version 0.1.0 --sums SHA256SUMS.txt

Los nombres de los archivos se buscan en la lista de huellas (no se dan por sabidos): si falta alguno
de los que hacen falta, el script falla y no escribe nada a medias.
"""

import argparse
import json
import re
import sys
from pathlib import Path

REPO = "cdramirez25/Orbit"
HOMEPAGE = f"https://github.com/{REPO}"
DESCRIPTION = "A modular dynamic island for macOS and Windows"

# Qué archivo de la versión es cada pieza (por su nombre).
ASSETS = {
    "mac_arm": re.compile(r"^Orbit_.+_aarch64\.dmg$"),
    "mac_intel": re.compile(r"^Orbit_.+_(x64|x86_64)\.dmg$"),
    "windows_portable": re.compile(r"^Orbit_.+_x64-portable\.zip$"),
}


class ManifestError(Exception):
    pass


def parse_sums(text: str) -> dict[str, str]:
    """`<huella>  <archivo>` por línea (el formato de `sha256sum`) -> {archivo: huella}."""
    sums: dict[str, str] = {}
    for line in text.splitlines():
        match = re.fullmatch(r"([0-9a-fA-F]{64})\s+\*?(.+)", line.strip())
        if match:
            sums[match.group(2)] = match.group(1).lower()
    return sums


def find_assets(sums: dict[str, str]) -> dict[str, tuple[str, str]]:
    """{pieza: (nombre del archivo, huella)}; falla si falta una pieza o hay dos candidatas."""
    found: dict[str, tuple[str, str]] = {}
    for key, pattern in ASSETS.items():
        matches = [name for name in sums if pattern.match(name)]
        if len(matches) != 1:
            raise ManifestError(
                f"se esperaba un archivo para '{key}' y hay {len(matches)}: {matches or 'ninguno'}"
            )
        found[key] = (matches[0], sums[matches[0]])
    return found


def download_url(version: str, name: str) -> str:
    return f"{HOMEPAGE}/releases/download/v{version}/{name}"


def cask(version: str, assets: dict[str, tuple[str, str]]) -> str:
    arm_name, arm_sum = assets["mac_arm"]
    intel_name, intel_sum = assets["mac_intel"]
    return f'''cask "orbit" do
  version "{version}"

  on_arm do
    sha256 "{arm_sum}"
    url "{download_url(version, arm_name)}"
  end
  on_intel do
    sha256 "{intel_sum}"
    url "{download_url(version, intel_name)}"
  end

  name "Orbit"
  desc "{DESCRIPTION}"
  homepage "{HOMEPAGE}"

  depends_on macos: ">= :ventura"

  app "Orbit.app"

  # La app no está notarizada (no hay cuenta de Apple Developer): sin esto macOS avisa de que no
  # puede verificarla. Solo se quita la marca de cuarentena a esta app.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{{appdir}}/Orbit.app"]
  end

  zap trash: [
    "~/Library/Application Support/dev.orbit.island",
    "~/Library/Caches/dev.orbit.island",
    "~/Pictures/Orbit",
  ]
end
'''


def scoop(version: str, assets: dict[str, tuple[str, str]]) -> str:
    name, digest = assets["windows_portable"]
    manifest = {
        "version": version,
        "description": DESCRIPTION,
        "homepage": HOMEPAGE,
        "license": "Unknown",
        "architecture": {"64bit": {"url": download_url(version, name), "hash": digest}},
        "shortcuts": [["Orbit.exe", "Orbit"]],
        "checkver": {"github": HOMEPAGE},
        "autoupdate": {
            "architecture": {
                "64bit": {"url": f"{HOMEPAGE}/releases/download/v${{version}}/Orbit_${{version}}_x64-portable.zip"}
            },
            "hash": {"url": f"{HOMEPAGE}/releases/download/v${{version}}/SHA256SUMS.txt"},
        },
    }
    return json.dumps(manifest, indent=2) + "\n"


def write_manifests(root: Path, version: str, sums_text: str) -> list[Path]:
    assets = find_assets(parse_sums(sums_text))
    files = {
        root / "Casks" / "orbit.rb": cask(version, assets),
        root / "bucket" / "orbit.json": scoop(version, assets),
    }
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return list(files)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="versión sin la 'v' (0.1.0)")
    parser.add_argument("--sums", required=True, type=Path, help="archivo con las huellas SHA-256")
    parser.add_argument("--root", type=Path, default=Path("."), help="raíz del repositorio")
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?", args.version):
        print(f"versión no válida: {args.version}", file=sys.stderr)
        return 2
    try:
        written = write_manifests(
            args.root, args.version, args.sums.read_text(encoding="utf-8")
        )
    except ManifestError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    for path in written:
        print(f"escrito {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
