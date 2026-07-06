# Product packaging: name, icon, and distribution

The product is named **Homer** — the storyteller who tells the story of a
PR. The CLI command stays `dv` (muscle memory, scriptability, and the
launch flow in ADR 0003 all depend on it), so the command name and the
product name are deliberately decoupled. The macOS bundle id is
`com.brundagejoe.homer`; `productName` is `Homer`.

We de-Electron-ify the shipped app so it reads as a product, not a dev
build: the BrowserWindow title, the macOS menu bar, the dock, and the
About panel all show "Homer" (via package.json `productName` plus
`app.setName`, `setAppUserModelId`, and `setAboutPanelOptions`), and the
default Electron icon is replaced by a custom one.

The **icon** is authored once as `build/icon.svg` (an open book with a
bookmark ribbon — the story of the change, and your place in it) and
rasterized with stock macOS tools only (`qlmanage` renders the SVG via
WebKit; `sips` resamples; `iconutil` builds the `.icns`). `build/gen-icons.sh`
regenerates `icon.icns` (bundle), `icon.png` (512, window/Linux), and
`icon@256.png` from the SVG, so the source of truth is the vector, not the
committed rasters.

Packaging uses **electron-builder** (config in the package.json `build`
key), producing a macOS `.dmg` (plus a `.app` `dir` target) from the
`electron-vite` build output in `out/`. `bun run dist` builds then
packages. Alternatives considered: `electron-forge` (heavier, its own
build pipeline duplicating electron-vite) and hand-rolled `electron-packager`
scripts (more glue for less). electron-builder is the smallest config that
yields an installable artifact and leaves room for auto-update later.

The build is **unsigned and un-notarized for now** (`mac.identity: null`).
Gatekeeper will warn on first open; a user runs it via right-click → Open
or `xattr -dr com.apple.quarantine`. Code-signing, notarization, and
auto-update are explicitly out of scope for V1 (carried forward from the
prior product's out-of-scope list) and are a distribution follow-up.
The global-install path (a `dv` on `PATH` that launches the packaged
`.app`) is tracked separately in #35; `bin/dv` remains the dev launcher.
