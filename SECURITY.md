# Security policy

Please report a suspected vulnerability through GitHub's private vulnerability reporting feature rather than a public issue.

Touch Grass hooks are local commands. Review them before trusting the plugin. The project has no runtime dependencies, makes no network calls, ignores transcript contents, hashes agent session IDs before using them as lease filenames, and validates preferences before saving them.

The animated banner loads a bundled `file://` page; it does not start a server. The companion accepts only the plugin's own reminder page from the request queue, and grants that page read access to the user's home directory rather than the whole filesystem. On macOS, the plugin and native companion communicate through a `0700` temporary directory with `0600` lease, presence, and request files. The companion uses an aggregate system idle-age query and current foreground-app check; it installs no event tap and requests no Accessibility, Input Monitoring, or Screen Recording permission. Reminder data is encoded into the local URL, and only local GIF/WebP files accepted by the plugin are displayed.
