# Import Touch Grass

This repository is both a Codex marketplace and a Claude Code marketplace. Replace `jd20030807/touch-grass` only when working from a fork.

## Codex

1. Run `codex plugin marketplace add jd20030807/touch-grass`.
2. Open `/plugins`, choose the **touch-grass** marketplace, and install **Touch Grass**.
3. Start a new Codex session.
4. Open `/hooks`, inspect the four local lifecycle hooks, and trust them if their commands point to `bin/touch-grass.mjs` inside the installed plugin.
5. Ask Codex: `Show my Touch Grass settings and test the nap reminder.`

Codex intentionally requires the user to review non-managed plugin hooks. Do not bypass that trust review.

## Claude Code

Run:

```bash
claude plugin marketplace add jd20030807/touch-grass
claude plugin install touch-grass@touch-grass --scope user
```

Then start a fresh session or run `/reload-plugins`. Review the plugin and hooks when prompted, then ask Claude: `Show my Touch Grass settings and test the nap reminder.`

## Local development

```bash
claude --plugin-dir ./plugins/touch-grass
```

For Codex, add the local marketplace root with `codex plugin marketplace add ./` and install it through `/plugins`.

The default delivery is a native hook message inside the active agent. Configuration is chat-first; no browser settings panel is opened.
