# Import Touch Grass

Touch Grass is both a Codex marketplace and a Claude Code marketplace. It runs local lifecycle hooks and opens a local cat-GIF reminder banner. Replace `jd20030807/touch-grass` only when installing a fork.

## Codex

1. Run `codex plugin marketplace add jd20030807/touch-grass`.
2. Run `codex plugin add touch-grass@touch-grass`, or install **Touch Grass** from `/plugins`.
3. Start a new Codex task.
4. Review the Touch Grass hooks and trust them only when they run `bin/touch-grass.mjs` inside the installed plugin.
5. Ask: `What can I customize in Touch Grass? Then show me a nap reminder.`

Codex intentionally requires review of non-managed plugin hooks. Do not bypass that review.

## Claude Code

Run:

```bash
claude plugin marketplace add jd20030807/touch-grass
claude plugin install touch-grass@touch-grass --scope user
```

Start a fresh session or run `/reload-plugins`, review the local hooks when prompted, then ask: `What can I customize in Touch Grass? Then show me a nap reminder.`

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

The normal settings experience is chat-based; there is no settings webpage. Reminders open as a small local `file://` banner with a matching cat animation.
