#!/bin/sh
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  printf '%s\n' 'Touch Grass only installs a companion on macOS.' >&2
  exit 1
fi

label=local.touch-grass.popup
plist="$HOME/Library/LaunchAgents/$label.plist"
destination_parent=${TOUCH_GRASS_APP_DIR:-"$HOME/Applications"}
destination_app="$destination_parent/Touch Grass.app"
domain="gui/$(id -u)"

# Stop the login agent first, or KeepAlive restarts the helper as fast as it is
# quit and the app cannot be removed cleanly.
launchctl bootout "$domain/$label" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
pkill -f "Touch Grass.app/Contents/MacOS/TouchGrassPopup" >/dev/null 2>&1 || true

rm -f "$plist"
rm -rf "$destination_app"
rm -rf "${TMPDIR:-/tmp}/touch-grass-$(id -u)"

printf '%s\n' 'Removed the Touch Grass companion, its login agent, and its temporary files.'
printf '%s\n' 'Your reminder preferences are still in ~/.touch-grass — delete that folder to remove them too.'
printf '%s\n' 'To finish, uninstall the plugin: claude plugin uninstall touch-grass@touch-grass (or codex plugin remove touch-grass@touch-grass).'
