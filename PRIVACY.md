# Privacy

Touch Grass runs locally and does not make network requests. It does not read or store prompt text, transcripts, source files, tool arguments, or tool results.

The lifecycle hook receives event JSON from the host and keeps only the current timestamp, event name, and a coarse host label. Settings and timing state live in the user's Touch Grass data directory:

- macOS and Linux: `~/.touch-grass`
- Windows: `%APPDATA%\\touch-grass`
- Override: `TOUCH_GRASS_HOME=/path/to/folder`

The settings page binds to `127.0.0.1`, uses a random per-process token, and shuts down after inactivity. It never listens on a public interface.
