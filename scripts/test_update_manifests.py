"""Pruebas de `update_manifests.py`: python3 -m unittest discover -s scripts"""

import json
import tempfile
import unittest
from pathlib import Path

import update_manifests as um

ARM = "a" * 64
INTEL = "b" * 64
ZIP = "c" * 64
SUMS = f"""{ARM}  Orbit_0.1.0_aarch64.dmg
{INTEL}  Orbit_0.1.0_x64.dmg
{ZIP}  Orbit_0.1.0_x64-portable.zip
{'d' * 64}  Orbit_0.1.0_x64-setup.exe
{'e' * 64}  Orbit_0.1.0_x64_en-US.msi
"""


class UpdateManifests(unittest.TestCase):
    def test_sums_are_read_in_sha256sum_format(self):
        sums = um.parse_sums(SUMS + "basura\n" + f"{'f' * 64} *binario.bin\n")
        self.assertEqual(sums["Orbit_0.1.0_aarch64.dmg"], ARM)
        self.assertEqual(sums["binario.bin"], "f" * 64)
        self.assertNotIn("basura", sums)

    def test_each_piece_is_found_by_its_name(self):
        assets = um.find_assets(um.parse_sums(SUMS))
        self.assertEqual(assets["mac_arm"], ("Orbit_0.1.0_aarch64.dmg", ARM))
        self.assertEqual(assets["mac_intel"], ("Orbit_0.1.0_x64.dmg", INTEL))
        self.assertEqual(assets["windows_portable"], ("Orbit_0.1.0_x64-portable.zip", ZIP))

    def test_the_intel_dmg_may_be_called_x86_64(self):
        sums = SUMS.replace("_x64.dmg", "_x86_64.dmg")
        self.assertEqual(um.find_assets(um.parse_sums(sums))["mac_intel"][0], "Orbit_0.1.0_x86_64.dmg")

    def test_a_missing_or_ambiguous_piece_is_an_error(self):
        without_zip = "\n".join(line for line in SUMS.splitlines() if "portable" not in line)
        with self.assertRaises(um.ManifestError):
            um.find_assets(um.parse_sums(without_zip))
        twice = SUMS + f"{'9' * 64}  Orbit_0.1.1_aarch64.dmg\n"
        with self.assertRaises(um.ManifestError):
            um.find_assets(um.parse_sums(twice))

    def test_the_cask_has_both_architectures_and_removes_quarantine(self):
        text = um.cask("0.1.0", um.find_assets(um.parse_sums(SUMS)))
        self.assertIn(f'sha256 "{ARM}"', text)
        self.assertIn(f'sha256 "{INTEL}"', text)
        self.assertIn("releases/download/v0.1.0/Orbit_0.1.0_aarch64.dmg", text)
        self.assertIn("releases/download/v0.1.0/Orbit_0.1.0_x64.dmg", text)
        self.assertIn("com.apple.quarantine", text)
        self.assertIn('app "Orbit.app"', text)

    def test_the_scoop_manifest_is_valid_json_with_the_portable_zip(self):
        data = json.loads(um.scoop("0.1.0", um.find_assets(um.parse_sums(SUMS))))
        self.assertEqual(data["version"], "0.1.0")
        self.assertEqual(data["architecture"]["64bit"]["hash"], ZIP)
        self.assertTrue(data["architecture"]["64bit"]["url"].endswith("Orbit_0.1.0_x64-portable.zip"))
        self.assertEqual(data["shortcuts"], [["Orbit.exe", "Orbit"]])
        # Scoop sustituye `${version}` él mismo al actualizar: tiene que llegar tal cual.
        self.assertTrue(
            data["autoupdate"]["architecture"]["64bit"]["url"].endswith(
                "/v${version}/Orbit_${version}_x64-portable.zip"
            )
        )
        self.assertTrue(data["autoupdate"]["hash"]["url"].endswith("/v${version}/SHA256SUMS.txt"))

    def test_files_are_written_only_when_everything_is_found(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaises(um.ManifestError):
                um.write_manifests(root, "0.1.0", "")
            self.assertFalse((root / "Casks").exists())
            written = um.write_manifests(root, "0.1.0", SUMS)
            self.assertEqual({path.name for path in written}, {"orbit.rb", "orbit.json"})
            self.assertTrue((root / "Casks" / "orbit.rb").is_file())
            self.assertTrue((root / "bucket" / "orbit.json").is_file())


if __name__ == "__main__":
    unittest.main()
