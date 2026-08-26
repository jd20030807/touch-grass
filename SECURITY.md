# Security policy

Please report a suspected vulnerability through GitHub's private vulnerability reporting feature rather than a public issue.

Touch Grass hooks are local commands. Review them before trusting the plugin. The project has no runtime dependencies, makes no network calls, ignores transcript contents, and validates preferences before saving them.

The animated banner loads a bundled `file://` page; it does not start a server. Reminder data is encoded into that local URL, and only local GIF/WebP files accepted by the plugin are displayed.
