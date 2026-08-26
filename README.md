<div align="center">

# touch-grass

**A tiny local break buddy for long vibe-coding sessions.**

Codex + Claude Code · local-only · no runtime dependencies

</div>

Touch Grass watches the rhythm of agent lifecycle events—not your screen, keyboard, prompts, or source code. After a configurable amount of recent active time, it shows a native hook reminder inside Codex or Claude Code for water, stretching, a snack, a short walk, eye rest, or a nap.

Settings are changed by talking to your agent. The first two cat packs will be designed from real-life model cats in a later art pass. Animated cat GIFs cannot be injected into both agents' native chat UI through their public plugin APIs, so the portable default uses a native text reminder. A fully local `popup` delivery mode remains available for the later cat-art pass.

## What works

- One plugin package for Codex and Claude Code
- Local activity accounting with an idle reset
- Six presets: water, stretch, snack, walk, eye rest, and nap
- Native in-agent reminder messages by default
- Chat-first configuration—no browser control panel
- Quiet hours, snooze, enable/disable, shuffle/cycle, and custom reminders
- Optional local popup delivery with a GIF, animated WebP, PNG, or JPEG per action
- Shared settings across supported agents in `~/.touch-grass`
- No telemetry, API key, hosted server, or runtime package install

## Test privately from this checkout

Nothing needs to be published first.

### Codex

Register this checkout as a local marketplace:

```bash
codex plugin marketplace add /absolute/path/to/touch-grass
```

Restart the desktop app, open `/plugins`, choose the **touch-grass** marketplace, and install **Touch Grass**. Start a new session and review/trust the plugin hooks in `/hooks`.

### Claude Code

Launch one temporary test session directly from the checkout:

```bash
claude --plugin-dir /absolute/path/to/touch-grass/plugins/touch-grass
```

This does not install the plugin for future sessions. Use `/reload-plugins` after editing hook files.

### Try the experience

Ask either agent:

```text
Show me the nap reminder.
Show my Touch Grass settings.
Remind me every 1 minute so I can test automatic reminders.
```

For the automatic test, continue using the agent for at least one minute and trigger another prompt or tool event. Restore the default afterward with `Remind me every 50 minutes.`

## Install from GitHub (after publication)

You can give an agent this repository and say:

> Import touch-grass from https://github.com/jd20030807/touch-grass

The repository-level [IMPORT.md](./IMPORT.md) gives the agent exact host-specific steps.

### Codex

```bash
codex plugin marketplace add jd20030807/touch-grass
```

Then open `/plugins`, install **Touch Grass** from the **touch-grass** marketplace, start a new session, and review/trust the plugin hooks in `/hooks`.

### Claude Code

```bash
claude plugin marketplace add jd20030807/touch-grass
claude plugin install touch-grass@touch-grass --scope user
```

Start a fresh session or run `/reload-plugins`.

Plugin hooks execute local code, so both hosts expose a review/trust step. Check that every Touch Grass hook runs `bin/touch-grass.mjs` inside the installed plugin.

## Use it by talking to your agent

Try requests like:

```text
Show my Touch Grass settings.
Remind me every 40 minutes.
Turn snack reminders off and keep nap reminders on.
Keep quiet between 10 PM and 8 AM.
Add a breathing reminder that says “Five slow breaths.”
Snooze Touch Grass for half an hour.
Show me the nap reminder.
```

The bundled skill translates these into validated local CLI commands. It never edits the state file directly and does not open a settings website.

## Add your own cat

Create a folder with any subset of these filenames:

```text
water.gif
stretch.gif
snack.gif
walk.gif
eyes.gif
nap.gif
```

Cat assets are used only in optional local popup mode. Ask your agent `Use my cat Juniper from /absolute/path/to/juniper`, or run:

```bash
touch-grass companions add juniper --name "Juniper" --dir /absolute/path/to/juniper
touch-grass companions use juniper
touch-grass config set delivery popup
touch-grass test nap
```

Missing actions fall back to their action icon. Use `touch-grass companions use rotate` to alternate between imported cats.

## CLI

```text
touch-grass status --json
touch-grass settings
touch-grass test nap
touch-grass config set interval 45
touch-grass config set delivery agent
touch-grass config set idle-reset 10
touch-grass config set quiet-hours 22:00-08:00
touch-grass reminders disable snack
touch-grass reminders add breathe --title "Breathing break" --message "Take five slow breaths." --icon "◌"
touch-grass companions add juniper --name "Juniper" --dir /path/to/juniper
touch-grass snooze 15
touch-grass doctor
```

## How active time works

Each hook event records a timestamp. The engine adds the wall-clock gap from the previous event only when that gap is shorter than `idleResetMinutes` (10 minutes by default). A longer gap resets active time to zero. This means Touch Grass notices sustained agent work without installing keyboard or screen monitoring.

The default reminder interval is 50 active minutes. Hook events arrive when a session starts, a prompt is submitted, a local tool finishes, or a turn stops. A reminder can therefore appear at the next lifecycle event after the threshold—not necessarily at the exact second it is crossed.

```text
agent event ── short gap ── agent event ── short gap ── agent event
     │                            │                            │
     └──────────── active time accumulates ───────────────────┘

agent event ───────────── gap longer than idle reset ── agent event
                                                           │
                                                     timer starts fresh
```

## Local architecture

```text
Codex hooks ──────┐
                  ├─> dependency-free Node CLI ─> config + timing state
Claude hooks ─────┘               │                   ~/.touch-grass
                                  ├─> native in-agent reminder (default)
                                  └─> local file popup (optional cat mode)
```

The default mode returns a standard hook `systemMessage`, which each host renders in its own interface. Optional popup mode loads only local HTML, CSS, icons, and personal cat files; it does not start a server or contact a website.

See [PRIVACY.md](./PRIVACY.md) and [SECURITY.md](./SECURITY.md) for the explicit boundaries.

## Development

Requires Node.js 18 or newer.

```bash
npm test
npm run check
npm run doctor
TOUCH_GRASS_HOME="$(mktemp -d)" node plugins/touch-grass/bin/touch-grass.mjs test nap --dry-run
```

Test the plugin directly in Claude Code:

```bash
claude --plugin-dir ./plugins/touch-grass
```

For Codex, add the repository root as a local marketplace:

```bash
codex plugin marketplace add ./
```

Then install through `/plugins`, start a new session, and review the hooks in `/hooks`.

## Roadmap

- Design the two bundled cat packs from the real model references
- Design a native local overlay helper for animated cat delivery
- Explore an optional Codex custom Pet pack; native Pet state is controlled by Codex, not plugins
- Accessibility and cross-platform QA across macOS, Windows, and Linux
- Submit to public plugin directories after the hook and artwork review

## License

[MIT](./LICENSE)
