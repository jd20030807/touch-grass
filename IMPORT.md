# Import Touch Grass

Touch Grass is both a Codex marketplace and a Claude Code marketplace. Local lifecycle hooks maintain opaque session leases; a local companion counts presence time and opens cat-GIF reminder banners. Replace `jd20030807/touch-grass` only when installing a fork.

## Codex

1. Run `codex plugin marketplace add jd20030807/touch-grass`.
2. Run `codex plugin add touch-grass@touch-grass`, or install **Touch Grass** from `/plugins`.
3. On macOS, run `npm run build:macos-helper` in the cloned repository and ask the user to open `plugins/touch-grass/native/macos/dist/Touch Grass.app` once. The agent must not pretend this happened.
4. Start a new Codex task.
5. Review the Touch Grass hooks and trust them only when they run `bin/touch-grass.mjs` inside the installed plugin.
6. Ask: `Introduce Touch Grass and tell me how I can personalize it.`

Codex intentionally requires review of non-managed plugin hooks. Do not bypass that review.

## Claude Code

Run:

```bash
claude plugin marketplace add jd20030807/touch-grass
claude plugin install touch-grass@touch-grass --scope user
```

Start a fresh CLI session, or open Claude Desktop's Code tab for a new session. Run `/reload-plugins` when appropriate, review the local hooks when prompted, then ask: `Introduce Touch Grass and tell me how I can personalize it.`

On macOS, build and open the native companion as described above before expecting reminder windows.

## Local development

For Claude Code:

```bash
claude --plugin-dir ./plugins/touch-grass
```

For Codex:

```bash
codex plugin marketplace add ./
codex plugin add touch-grass@touch-grass
```

The normal settings experience is chat-based; there is no settings webpage. The plugin sends reminders across a private local bridge to the native popup companion.
