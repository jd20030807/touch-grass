# Import Touch Grass

Touch Grass is both a Codex marketplace and a Claude Code marketplace. Its local companion recognizes the desktop apps, counts presence time, evaluates reminder schedules, and opens animated banners. Optional lifecycle hooks extend counting to supported terminals and editors. Replace `jd20030807/touch-grass` only when installing a fork.

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
4. Run `node "$HOME/.local/share/touch-grass/repository/plugins/touch-grass/bin/touch-grass.mjs" welcome-banner`.
5. Only tell the user the import succeeded after the welcome banner command exits successfully.
6. Automatic timing is now available whenever Codex is frontmost and the Mac has recent input; it does not require a new task or hook approval.
7. Start a new Codex task before asking Touch Grass to change preferences, because an already-open task may not have loaded the new skill.
8. Ask: `Introduce Touch Grass and tell me how I can personalize it.`

The bundled hooks are optional and only add Codex CLI or supported editor sessions. If the user wants those counted, let Codex present the hooks for review and trust them only when they run `bin/touch-grass.mjs` inside the installed plugin. Never bypass that review.

## Claude Code

Complete **Download and native companion** above, then run:

```bash
claude plugin marketplace add "$HOME/.local/share/touch-grass/repository"
claude plugin install touch-grass@touch-grass --scope user
node "$HOME/.local/share/touch-grass/repository/plugins/touch-grass/bin/touch-grass.mjs" welcome-banner
```

Only tell the user the import succeeded after the welcome banner command exits successfully. Automatic timing is available whenever Claude Desktop is frontmost and the Mac has recent input. Start a fresh session only before asking Touch Grass to change preferences, because an already-open conversation may not have loaded the new skill. Then ask: `Introduce Touch Grass and tell me how I can personalize it.`

Claude Code CLI and supported editor sessions still use the bundled hooks as an optional host signal. Run `/reload-plugins` when appropriate and let the user review those hooks if they want non-desktop sessions counted.

The native companion must remain installed and running before expecting reminder windows.
The welcome banner is shown once per local installation. Do not replace it with a chat message if the command fails.

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
