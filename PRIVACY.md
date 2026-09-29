# Privacy

Touch Grass runs locally and makes no network requests. It does not read or store prompt text, transcripts, source files, keystrokes, clicks, pointer coordinates, screen contents, window titles, tool arguments, or tool results.

On macOS, the native companion checks whether Codex or Claude Desktop is currently in front and asks the operating system how many seconds have passed since any keyboard or mouse input. The apps are recognized by exact application bundle identifiers; no foreground-app name or history is written to disk. It does not receive the key, button, location, text, or application history. No global event tap or keylogger is installed.

Optional agent lifecycle hooks let Touch Grass recognize Codex CLI, Claude Code CLI, and supported editor sessions. Those hooks keep only an opaque, hashed session lease alive without storing the original agent session ID. Desktop-app timing does not require those hooks.

The private temporary bridge stores only optional session availability and an aggregate presence snapshot: random helper/stretch identifiers, cumulative engaged milliseconds, sample time, and whether the user is currently engaged. Preferences and reminder timing state live in the user's Touch Grass data directory:

- macOS and Linux: `~/.touch-grass`
- Windows: `%APPDATA%\\touch-grass`
- Development override: `TOUCH_GRASS_HOME=/path/to/folder`

There is no settings server or hosted control panel. On macOS, the local scheduler writes one reminder request to a user-private directory under the system temporary folder. The native companion consumes that request and displays bundled UI files plus the selected local cat animation. Personal cat files never leave the computer. Optional session leases expire, and a longer period without engagement starts a new aggregate coding stretch.
