#!/bin/sh
# Sizes the icons for the web / Home Screen version and the in-app About and What's New screens.
# Run from the repo root after tools/icons/make_icons.swift (macOS: uses sips).
set -e
v=src/vendor
sips -z 256 256 assets/app-icon.png --out $v/app-icon.png >/dev/null
sips -z 256 256 assets/app-icon-demo.png --out $v/app-icon-demo.png >/dev/null
sips -z 180 180 assets/app-icon-square.png --out $v/apple-touch-icon.png >/dev/null
sips -z 192 192 assets/app-icon-square.png --out $v/icon-192.png >/dev/null
sips -z 512 512 assets/app-icon-square.png --out $v/icon-512.png >/dev/null
cp $v/icon-512.png $v/icon-maskable-512.png
echo "Wrote the web icons in $v"
