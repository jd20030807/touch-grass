# Privacy

Touch Grass runs locally and makes no network requests. It does not read or store prompt text, transcripts, source files, keystrokes, screen activity, tool arguments, or tool results.

The lifecycle hook keeps only local timing metadata, an event name, and a coarse host label. Preferences and timing state live in the user's Touch Grass data directory:

- macOS and Linux: `~/.touch-grass`
- Windows: `%APPDATA%\\touch-grass`
- Development override: `TOUCH_GRASS_HOME=/path/to/folder`

There is no settings server or hosted control panel. On macOS, the hook writes one local reminder request to a user-private directory under the system temporary folder. The native companion consumes that request and displays bundled UI files plus the selected local cat animation. Personal cat files never leave the computer.
