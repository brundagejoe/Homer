#!/bin/sh
# Regenerate the Homer app icons from build/icon.svg (macOS only).
# Produces: icon.icns (bundle), icon.png (512, window/linux), icon@256.png.
# Uses only stock macOS tools (qlmanage renders SVG via WebKit; sips + iconutil).
set -e
cd "$(dirname "$0")"

qlmanage -t -s 1024 -o . icon.svg >/dev/null 2>&1
mv -f icon.svg.png master-1024.png

ICONSET=Homer.iconset
rm -rf "$ICONSET" icon.icns
mkdir -p "$ICONSET"
gen() { sips -z "$2" "$2" master-1024.png --out "$ICONSET/$1" >/dev/null; }
gen icon_16x16.png 16
gen icon_16x16@2x.png 32
gen icon_32x32.png 32
gen icon_32x32@2x.png 64
gen icon_128x128.png 128
gen icon_128x128@2x.png 256
gen icon_256x256.png 256
gen icon_256x256@2x.png 512
gen icon_512x512.png 512
cp master-1024.png "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o icon.icns

sips -z 512 512 master-1024.png --out icon.png >/dev/null
sips -z 256 256 master-1024.png --out icon@256.png >/dev/null

rm -rf "$ICONSET" master-1024.png
echo "Generated: icon.icns icon.png icon@256.png"
