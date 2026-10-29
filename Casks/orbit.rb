cask "orbit" do
  version "0.1.0"

  on_arm do
    sha256 "5d9a155ac35c7fcfd78d2e54677f5b66f7460cfa724bcb333b95a50b46dd067c"
    url "https://github.com/cdramirez25/Orbit/releases/download/v0.1.0/Orbit_0.1.0_aarch64.dmg"
  end
  on_intel do
    sha256 "47c9f9c146f09afe53872b752b931cceeae4fbc6f907f83039bd7e526c89b197"
    url "https://github.com/cdramirez25/Orbit/releases/download/v0.1.0/Orbit_0.1.0_x64.dmg"
  end

  name "Orbit"
  desc "A modular dynamic island for macOS and Windows"
  homepage "https://github.com/cdramirez25/Orbit"

  depends_on macos: ">= :ventura"

  app "Orbit.app"

  # La app no está notarizada (no hay cuenta de Apple Developer): sin esto macOS avisa de que no
  # puede verificarla. Solo se quita la marca de cuarentena a esta app.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Orbit.app"]
  end

  zap trash: [
    "~/Library/Application Support/dev.orbit.island",
    "~/Library/Caches/dev.orbit.island",
    "~/Pictures/Orbit",
  ]
end
