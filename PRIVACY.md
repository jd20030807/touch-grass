# Privacy

Touch Grass runs locally and does not make network requests. It does not read or store prompt text, transcripts, source files, tool arguments, or tool results.

The lifecycle hook receives event JSON from the host and keeps only the current timestamp, event name, and a coarse host label. Settings and timing state live in the user's Touch Grass data directory:

- macOS and Linux: `~/.touch-grass`
- Windows: `%APPDATA%\\touch-grass`
- Override: `TOUCH_GRASS_HOME=/path/to/folder`

The default reminder is returned directly to the active agent as hook output. Touch Grass does not start a settings server.

Optional popup mode opens a local `file://` page containing bundled UI assets and any personal cat file selected for that reminder. It does not contact a website.
