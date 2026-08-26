# Security policy

Please report a suspected vulnerability through GitHub's private vulnerability reporting feature rather than a public issue.

Touch Grass hooks are local commands. Review them before trusting the plugin. The project intentionally has no runtime dependencies, makes no network calls, ignores transcript contents, and validates settings before writing them. Native reminders are returned as hook output; optional animated reminders load a bundled `file://` page without starting a server.
