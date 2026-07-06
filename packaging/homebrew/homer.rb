# frozen_string_literal: true

# Homebrew CASK TEMPLATE for Homer — NOT yet published. See docs/INSTALL.md
# ("Homebrew status") for why the install script is the recommended path today.
#
# A cask installs a *prebuilt* .app from a hosted artifact; it does not build
# from source. To ship this you need, per release:
#   1. A GitHub Release with the `.dmg` attached at a stable URL.
#   2. The dmg's sha256 (`shasum -a 256 Homer-<version>-arm64.dmg`).
#   3. A tap repo named `homebrew-homer` (e.g. github.com/brundagejoe/homebrew-homer)
#      containing `Casks/homer.rb`, so users can:
#         brew tap brundagejoe/homer
#         brew install --cask homer
#
# Fill the << >> placeholders when a release exists. Because the build is
# currently unsigned/un-notarized, users would still hit Gatekeeper on first
# launch (the cask can't fix that without signing); `--no-quarantine` below is
# the pragmatic escape hatch until the app is signed + notarized.
#
# This cask installs the .app but does NOT put `homer` on PATH — Homebrew casks
# only stage app bundles. A published distribution would add a companion
# `binary` stanza pointing at a shim inside the bundle, or ship `homer` via a
# separate formula. For now the install script owns the `homer` shim.

cask "homer" do
  version "<<VERSION>>"          # e.g. "0.1.0"
  sha256 "<<SHA256_OF_DMG>>"     # shasum -a 256 dist/Homer-<version>-arm64.dmg

  url "https://github.com/brundagejoe/<<REPO>>/releases/download/v#{version}/Homer-#{version}-arm64.dmg"
  name "Homer"
  desc "Guided tour of a GitHub PR: an agent-generated scrollytelling story, then a full diff review"
  homepage "https://github.com/brundagejoe/<<REPO>>"

  # Apple Silicon only for now (the build target is arm64). Add a second block
  # / `on_intel` + `on_arm` when an x86_64 dmg is produced.
  depends_on arch: :arm64

  app "Homer.app"

  # Unsigned build: skip the quarantine flag so Gatekeeper doesn't hard-block it.
  # Remove this once the app is code-signed and notarized.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Homer.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/Homer"
  ]
end
