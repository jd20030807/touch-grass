<div align="center">

# touch-grass

**A tiny local cat who interrupts long vibe-coding sessions—in a good way.**

Codex + Claude Code · local-only · cat GIFs required

</div>

Touch Grass notices when an agent session has stayed active for a while, then opens a small local banner with a cat doing the suggested break: drinking water, stretching, snacking, walking, resting its eyes, or napping.

There is no settings website. People customize it by talking to Codex or Claude Code, and the agent answers in ordinary language. The plugin, preferences, timing data, banner, and cat files all stay on the computer.

> [!IMPORTANT]
> The reminder engine and popup banner work now. The two default cat packs are intentionally not included yet; they will be created from the project's real-life model cats. Until those references and animations are supplied, previews show a clearly labeled development placeholder and `touch-grass doctor` reports that the release is not art-ready.

## What works now

- One local plugin package for Codex and Claude Code
- A compact native macOS popup banner fed by local agent hooks
- Six built-in reminder types: water, stretch, snack, walk, eyes, and nap
- A matching animated cat asset required for every reminder
- Conversational customization with no settings panel or technical settings dump
- Quiet periods, snoozing, reminder choices, timing changes, and cat rotation
- Importing personal cats from a local folder
- No telemetry, hosted service, API key, or runtime package install

## Test this checkout privately

Nothing needs to be published first.

### Codex

Register this checkout as a local marketplace:

```bash
codex plugin marketplace add /absolute/path/to/touch-grass
codex plugin add touch-grass@touch-grass
```

Build and open the native popup companion once:

```bash
npm run build:macos-helper
open "plugins/touch-grass/native/macos/dist/Touch Grass.app"
```

Keep the companion running, restart Codex, start a new task, and review the local Touch Grass hooks when prompted.

### Claude Code

Launch one temporary session directly from the checkout:

```bash
claude --plugin-dir /absolute/path/to/touch-grass/plugins/touch-grass
```

This does not install the plugin for future sessions. Run `/reload-plugins` after changing plugin or hook files.

On macOS, build and open the same local popup companion before testing reminders.

### Try the experience

Ask either agent:

```text
What can I customize in Touch Grass?
Remind me to take a break every minute while I test this.
```

The first request displays the one-time introduction and customization examples. For automatic timing, keep using the agent for at least a minute and cause another prompt or tool event. Afterwards, say `Remind me about every 50 minutes again.`

The current popup uses the deliberate art placeholder. It is not a substitute cat and will be replaced only after the real-cat art pass.

## Use it by talking naturally

There is no control panel to learn. Try phrases such as:

```text
Remind me to take a break every 40 minutes.
Don't remind me about snacks anymore.
Keep nap reminders, but turn walks off.
Don't interrupt me between 10 PM and 8 AM.
Snooze reminders for half an hour.
Use my cat Mochi for icon from /absolute/path/to/mochi.
```

Touch Grass responds in the same style—for example, `Okay, I won't remind you about snacks anymore.` It does not expose internal field names or announce configuration mutations.

## Add your own cat

A cat pack is a local folder containing all six matching animations:

```text
water.gif
stretch.gif
snack.gif
walk.gif
eyes.gif
nap.gif
```

Animated WebP files with the same names also work. Static images and incomplete packs are rejected because the cat action is part of every reminder, not an optional decoration.

Then ask:

```text
Use my cat Mochi from /absolute/path/to/mochi.
Rotate through my cats.
```

## How it stays local

The plugin receives lifecycle events from the active coding agent and stores only enough local timing state to recognize a continuing coding stretch. It does not inspect screen activity, keystrokes, prompts, transcripts, source code, tool arguments, or tool results.

A reminder appears on the next agent event after a break becomes due, so it may not appear at the exact second. A meaningful pause naturally starts a fresh coding stretch.

```text
Codex hooks ──────┐
                  ├── local Node command ── local timing/preferences
Claude hooks ─────┘             │
                                └── private /tmp bridge
                                           │
                                           └── native popup + matching cat GIF
```

On macOS, a tiny native companion owns the floating window outside the coding agent's GUI sandbox. The hook sends it a local `file://` reminder through a user-private temporary directory. There is no browser tab, server, or network request. Windows and Linux currently use a dedicated Chromium app window while native companions are developed for those platforms.

See [PRIVACY.md](./PRIVACY.md) and [SECURITY.md](./SECURITY.md) for the exact boundaries.

## Install from GitHub after publication

Once this repository is public, someone can tell their agent:

> Import touch-grass from https://github.com/jd20030807/touch-grass

The repository-level [IMPORT.md](./IMPORT.md) tells the agent how to register and install the plugin. Both hosts let users review local hook commands before trusting them.

## Maintainer commands

Requires Node.js 18 or newer.

```bash
npm test
npm run check
npm run build:macos-helper
npm run doctor
TOUCH_GRASS_HOME="$(mktemp -d)" node plugins/touch-grass/bin/touch-grass.mjs test nap --dry-run
```

The low-level CLI remains available for development, but the normal interface is conversation:

```text
touch-grass settings
touch-grass test nap
touch-grass reminders disable snack
touch-grass companions add mochi --name "Mochi" --dir /path/to/mochi
touch-grass companions use rotate
touch-grass snooze 15
touch-grass doctor
```

## Before the first public release

- Create two complete six-action cat packs from the real model references
- Add them to `assets/companions/manifest.json`
- Add native popup companions for Windows and Linux
- Confirm animated GIF/WebP playback in every native popup
- Run the automated tests and both host plugin validators
- Review installation from a clean local Codex and Claude Code profile
- Publish the repository and replace any owner URLs if needed

## License

[MIT](./LICENSE)
