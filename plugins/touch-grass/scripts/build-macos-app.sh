#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
source_dir="$plugin_root/native/macos"
output_dir="${1:-$source_dir/dist}"
app_dir="$output_dir/Touch Grass.app"
contents_dir="$app_dir/Contents"
binary_dir="$contents_dir/MacOS"
cache_dir="${TMPDIR:-/tmp}/touch-grass-swift-cache"

mkdir -p "$binary_dir" "$cache_dir"
cp "$source_dir/Info.plist" "$contents_dir/Info.plist"
swiftc \
  -parse-as-library \
  -module-cache-path "$cache_dir" \
  -framework AppKit \
  -framework WebKit \
  "$source_dir/TouchGrassPopup.swift" \
  -o "$binary_dir/TouchGrassPopup"
chmod 755 "$binary_dir/TouchGrassPopup"
codesign --force --deep --sign - "$app_dir"

printf '%s\n' "$app_dir"
