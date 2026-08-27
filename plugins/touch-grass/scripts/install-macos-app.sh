#!/bin/sh
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  printf '%s\n' 'Touch Grass automatic reminders currently require macOS.' >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
destination_parent=${TOUCH_GRASS_APP_DIR:-"$HOME/Applications"}
destination_app="$destination_parent/Touch Grass.app"
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/touch-grass-install.XXXXXX")

cleanup() {
  rm -rf "$build_dir"
}
trap cleanup EXIT HUP INT TERM

sh "$script_dir/build-macos-app.sh" "$build_dir" >/dev/null
mkdir -p "$destination_parent"
/usr/bin/ditto "$build_dir/Touch Grass.app" "$destination_app"

if [ "${TOUCH_GRASS_NO_LAUNCH:-0}" != "1" ]; then
  heartbeat="${TMPDIR:-/tmp}/touch-grass-$(id -u)/helper.json"
  /usr/bin/open "$destination_app" >/dev/null 2>&1 || true
  sleep 2

  if ! find "$heartbeat" -mmin -1 -print -quit 2>/dev/null | grep -q .; then
    nohup "$destination_app/Contents/MacOS/TouchGrassPopup" >/dev/null 2>&1 &
    sleep 1
  fi

  if ! find "$heartbeat" -mmin -1 -print -quit 2>/dev/null | grep -q .; then
    printf '%s\n' 'Touch Grass.app was installed, but the popup helper did not start.' >&2
    printf '%s\n' "Open it manually: $destination_app" >&2
    exit 1
  fi
fi

printf '%s\n' "$destination_app"
