# Product packaging: name, icon, and distribution

The product is named **Homer** — the storyteller who tells the story of a
PR — and the CLI command matches it: `homer <pr-url>`. The macOS bundle id
is `com.brundagejoe.homer`; `productName` is `Homer`.

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

## Global install (#35)

`bin/homer` remains the **dev** launcher (runs Electron against this repo's
`out/`). The **global** path installs the packaged `.app` to `/Applications`
and a `homer` shim on `PATH` (`bin/homer-global`, installed by
`scripts/install.sh`; removed by `scripts/uninstall.sh`). The full guide is
`docs/INSTALL.md`.

The load-bearing problem: Homer resolves the *target repo* from the launch
cwd, but a globally-installed `.app` launches with cwd `/`, not the
reviewer's repo. The shim therefore captures `$PWD` and forwards it:
`open -na "Homer" --args --repo="$PWD" "<pr-url>"`. `open -n` forces a new
instance so args are delivered even when Homer is already open (the
single-instance lock hands the argv to the live window). The app resolves
its repo path via `resolveRepoPath` (a pure, unit-tested helper):
`--repo=` flag → `DV_REPO` env → cwd — the last case keeps the in-repo dev
flow working unchanged. Switching the *repo* of an already-open window is a
known limitation (a second `homer` only re-navigates the PR); full multi-repo
is out of scope.

**Homebrew was evaluated and deferred.** A cask installs a *prebuilt,
hosted* `.app`, so it requires a GitHub Release with a versioned `.dmg` URL
+ sha256 and a `homebrew-homer` tap — none of which exist yet — and it
neither removes the Gatekeeper prompt for an unsigned build nor provides the
`homer` command (casks only stage the app bundle). The install script is the
recommended path until the app is signed/notarized and there's a
CI-produced release per version. A ready-to-fill cask template lives at
`packaging/homebrew/homer.rb`. See `docs/INSTALL.md` for the full tradeoff.
