<div align="center">

# touch-grass

**A tiny local cat who interrupts long vibe-coding sessions—in a good way.**

Codex + Claude Code · local-only · cat GIFs required

</div>

Touch Grass notices sustained, user-present coding time, then opens a notification-sized local banner with a cat doing the suggested break: drinking water, stretching, snacking, turning in a circle as the walk cue, resting its eyes, or getting ready for bed.

There is no settings website. People customize it by talking to Codex or Claude Code, and the agent answers in ordinary language. The plugin, preferences, timing data, banner, and cat files all stay on the computer.

> [!IMPORTANT]
> Touch Grass now includes two complete animated companions based on the project's real-life model cats: Nian and You. Each has matching eight-frame water, stretch, snack, walk-cue, eye-rest, and bedtime GIFs, and the default `rotate` mode alternates between them.

## What works now

- One local plugin package for Codex and Claude Code Desktop, CLI, and supported IDE hosts
- A compact native macOS popup banner fed by a local, privacy-minimal presence counter
- Six built-in reminder groups: water, stretch, snack, walk, eyes, and two-stage bedtime
- Independent schedules for every reminder instead of one random rotation
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

For a temporary CLI session, launch directly from the checkout:

```bash
claude --plugin-dir /absolute/path/to/touch-grass/plugins/touch-grass
```

This does not install the plugin for future sessions. Run `/reload-plugins` after changing plugin or hook files.

For Claude Code Desktop, install this checkout as a local marketplace/plugin, then use the Code tab for a new session. Claude Desktop and the CLI share Claude Code plugin settings and hooks. On macOS, build and open the same local popup companion before testing reminders.

### Try the experience

Ask either agent:

```text
What can I customize in Touch Grass?
Remind me to walk around every minute while I test this.
```

The first request displays the one-time introduction and customization examples. For automatic timing, keep the coding app in front and continue using your keyboard or mouse for at least a minute. A due reminder is delivered on the next agent event. Afterwards, say `Remind me to walk around every two hours again.`

The popup uses the bundled Nian and You animations. The action-icon placeholder appears only if an asset cannot be loaded.

## Use it by talking naturally

There is no control panel to learn. Try phrases such as:

```text
Remind me to walk around every 40 minutes.
Keep quiet from 10 PM to 8 AM.
Turn off snack and bedtime reminders.
Snooze reminders for 30 minutes.
Use my cat Mochi from /absolute/path/to/mochi.
Add a breathing reminder with this GIF.
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
bedtime.gif
```

Animated WebP files with the same names also work. Static images and incomplete packs are rejected because the cat action is part of every reminder, not an optional decoration.

Then ask:

```text
Use my cat Mochi from /absolute/path/to/mochi.
Rotate through my cats.
```

## How it stays local

Agent lifecycle hooks only maintain an opaque, expiring local session lease. The macOS companion counts time when that host's coding app is in front and macOS reports that the keyboard or mouse was used recently. Codex and Claude Desktop are matched by their exact bundle identifiers; Terminal, iTerm, Warp, VS Code, Cursor, and similar hosts remain compatibility paths for Claude Code CLI/IDE sessions. Touch Grass asks the operating system only for elapsed idle time; it does not install event taps, capture screen contents, or record keys, clicks, pointer coordinates, window titles, prompts, transcripts, source code, tool arguments, or tool results.

A reminder appears on the next agent event after it becomes due, so it may not appear at the exact second. Agent-only work stops extending the timers once recent user input expires. Eye, water, stretch, and walk reminders keep separate engaged-coding clocks; a meaningful pause starts each of those clocks fresh. Snack and bedtime reminders use local clock time and only appear while the user is present in the coding app near the scheduled moment.

```text
Codex hooks ──────┐
                  ├── opaque local session leases ──┐
Claude hooks ─────┘                                 │
                                                   ├── aggregate engaged time
foreground coding app + recent input age ──────────┘            │
                                                                 └── native popup + matching cat GIF
```

On macOS, a tiny native companion owns the presence counter and floating window outside the coding agent's GUI sandbox. The hook sends it a local `file://` reminder through a user-private temporary directory. There is no browser tab, server, network request, global input listener, or special activity-monitoring permission. Windows and Linux currently use a dedicated Chromium app window for manual previews; automatic presence-aware timing awaits native companions for those platforms.

Claude Desktop contains Chat, Cowork, and Code in one application. Touch Grass requires a live Claude Code lease before Claude Desktop can count, but deliberately does not inspect which internal tab is selected. A still-live Code session plus activity elsewhere in Claude Desktop can therefore count until the lease ends or expires. This small overcount avoids reading Claude's UI or window contents.

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
TOUCH_GRASS_HOME="$(mktemp -d)" node plugins/touch-grass/bin/touch-grass.mjs test bedtime --dry-run
```

The low-level CLI remains available for development, but the normal interface is conversation:

```text
touch-grass settings
touch-grass test bedtime
touch-grass reminders disable snack
touch-grass reminders interval walk 40
touch-grass reminders bedtime 23:00 --wind-down 30
touch-grass companions add mochi --name "Mochi" --dir /path/to/mochi
touch-grass companions use rotate
touch-grass snooze 15
touch-grass doctor
```

## Before the first public release

- Confirm animated GIF/WebP playback in every native popup
- Run the automated tests and both host plugin validators
- Review installation from a clean local Codex and Claude Code profile
- Publish the repository and replace any owner URLs if needed

## License

[MIT](./LICENSE)
