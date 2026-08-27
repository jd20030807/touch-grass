# Import Touch Grass

Touch Grass is both a Codex marketplace and a Claude Code marketplace. Local lifecycle hooks maintain opaque session leases; a local companion counts presence time and opens animated reminder banners. Replace `jd20030807/touch-grass` only when installing a fork.

## Download and native companion

Keep the repository outside the user's current coding project. On macOS, use a stable local checkout such as `~/.local/share/touch-grass/repository`:

```bash
mkdir -p "$HOME/.local/share/touch-grass"
git clone https://github.com/jd20030807/touch-grass.git "$HOME/.local/share/touch-grass/repository"
cd "$HOME/.local/share/touch-grass/repository"
npm run install:macos-helper
```

If that checkout already exists and its `origin` is this repository, update it with `git pull --ff-only` instead of cloning again. Do not overwrite an unrelated directory. The install command compiles the helper for the user's own Mac, copies it to `~/Applications/Touch Grass.app`, and opens it. Ask before replacing an existing installation from another source.

## Codex

1. Complete **Download and native companion** above.
2. Run `codex plugin marketplace add "$HOME/.local/share/touch-grass/repository"`.
3. Run `codex plugin add touch-grass@touch-grass`, or install **Touch Grass** from `/plugins`.
4. Start a new Codex task.
5. Review the Touch Grass hooks and trust them only when they run `bin/touch-grass.mjs` inside the installed plugin.
6. Ask: `Introduce Touch Grass and tell me how I can personalize it.`

Codex intentionally requires review of non-managed plugin hooks. Do not bypass that review.

## Claude Code

Complete **Download and native companion** above, then run:

```bash
claude plugin marketplace add "$HOME/.local/share/touch-grass/repository"
claude plugin install touch-grass@touch-grass --scope user
```

Start a fresh CLI session, or open Claude Desktop's Code tab for a new session. Run `/reload-plugins` when appropriate, review the local hooks when prompted, then ask: `Introduce Touch Grass and tell me how I can personalize it.`

The native companion must remain installed and running before expecting reminder windows.

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
