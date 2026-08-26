# Privacy

Touch Grass runs locally and makes no network requests. It does not read or store prompt text, transcripts, source files, keystrokes, clicks, pointer coordinates, screen contents, window titles, tool arguments, or tool results.

Agent lifecycle hooks keep an opaque, hashed session lease alive without storing the original agent session ID. On macOS, the native companion checks whether a recognized coding app is currently in front and asks the operating system how many seconds have passed since any keyboard or mouse input. It does not receive the key, button, location, text, or application history. No global event tap or keylogger is installed.

The private temporary bridge stores only session availability and an aggregate presence snapshot: random helper/stretch identifiers, cumulative engaged milliseconds, sample time, and whether the user is currently engaged. Preferences and reminder timing state live in the user's Touch Grass data directory:

- macOS and Linux: `~/.touch-grass`
- Windows: `%APPDATA%\\touch-grass`
- Development override: `TOUCH_GRASS_HOME=/path/to/folder`

There is no settings server or hosted control panel. On macOS, the hook writes one local reminder request to a user-private directory under the system temporary folder. The native companion consumes that request and displays bundled UI files plus the selected local cat animation. Personal cat files never leave the computer. Session leases expire, and a longer period without engagement starts a new aggregate coding stretch.
