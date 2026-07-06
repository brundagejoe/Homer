#!/bin/sh
# Regenerate the Homer app icons from build/icon-source.png (1024×1024 RGBA with
# transparent corners; macOS only). Produces: icon.icns (bundle), icon.png
# (512, window/linux), icon@256.png. Uses only stock macOS tools (sips + iconutil).
set -e
cd "$(dirname "$0")"

SRC=icon-source.png
ICONSET=Homer.iconset
rm -rf "$ICONSET" icon.icns
mkdir -p "$ICONSET"
gen() { sips -z "$2" "$2" "$SRC" --out "$ICONSET/$1" >/dev/null; }
gen icon_16x16.png 16
gen icon_16x16@2x.png 32
gen icon_32x32.png 32
gen icon_32x32@2x.png 64
gen icon_128x128.png 128
gen icon_128x128@2x.png 256
gen icon_256x256.png 256
gen icon_256x256@2x.png 512
gen icon_512x512.png 512
cp "$SRC" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o icon.icns

sips -z 512 512 "$SRC" --out icon.png >/dev/null
sips -z 256 256 "$SRC" --out icon@256.png >/dev/null

rm -rf "$ICONSET"
echo "Generated: icon.icns icon.png icon@256.png (from $SRC)"
