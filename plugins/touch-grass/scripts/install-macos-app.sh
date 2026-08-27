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

label=local.touch-grass.popup
agents_dir="$HOME/Library/LaunchAgents"
plist="$agents_dir/$label.plist"

# Register a login agent so the popup companion comes back after a restart.
# Without this the helper only runs until the next reboot, and reminders then
# stop appearing with nothing on screen to say why.
mkdir -p "$agents_dir"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$destination_app/Contents/MacOS/TouchGrassPopup</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
PLIST

if [ "${TOUCH_GRASS_NO_LAUNCH:-0}" != "1" ]; then
  heartbeat="${TMPDIR:-/tmp}/touch-grass-$(id -u)/helper.json"
  domain="gui/$(id -u)"

  # Stop whatever is running first. An upgrade otherwise leaves the previous
  # helper alive, its heartbeat still fresh, and the new build never runs.
  launchctl bootout "$domain/$label" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
  pkill -f "Touch Grass.app/Contents/MacOS/TouchGrassPopup" >/dev/null 2>&1 || true
  sleep 1

  launchctl bootstrap "$domain" "$plist" >/dev/null 2>&1 || launchctl load -w "$plist" >/dev/null 2>&1 || true
  sleep 2

  if ! find "$heartbeat" -mmin -1 -print -quit 2>/dev/null | grep -q .; then
    /usr/bin/open "$destination_app" >/dev/null 2>&1 || true
    sleep 2
  fi

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
