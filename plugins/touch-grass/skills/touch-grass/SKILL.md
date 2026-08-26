---
name: touch-grass
description: Configure and test local break reminders while using Codex or Claude Code. Use when the user asks to change reminder timing, enable or disable break types, add a custom reminder or cat companion, snooze reminders, inspect status, or open Touch Grass settings.
---

# Touch Grass

Translate the user's request into the bundled `touch-grass` CLI. Prefer the executable named `touch-grass` when it is on `PATH`. Otherwise run `node <plugin-root>/bin/touch-grass.mjs`, where `<plugin-root>` is the plugin directory containing this skill under `skills/touch-grass/`.

Do not edit `~/.touch-grass/config.json` directly. The CLI validates and atomically saves changes.

Common requests:

- “Remind me every 35 minutes” → `touch-grass config set interval 35`
- “Reset the timer after 15 idle minutes” → `touch-grass config set idle-reset 15`
- “Keep quiet from 10 PM to 8 AM” → `touch-grass config set quiet-hours 22:00-08:00`
- “Turn snack reminders off” → `touch-grass reminders disable snack`
- “Turn naps back on” → `touch-grass reminders enable nap`
- “Add a breathing reminder” → `touch-grass reminders add breathing --title "Breathing break" --message "Take five slow breaths." --icon "◌"`
- “Use my cat Juniper from this folder” → `touch-grass companions add juniper --name "Juniper" --dir "/absolute/path"`
- “Rotate my cats” → `touch-grass companions use rotate`
- “Show my settings” → `touch-grass settings`
- “Keep reminders inside this agent” → `touch-grass config set delivery agent`
- “Use the animated local popup” → `touch-grass config set delivery popup`
- “Show me what the nap reminder looks like” → `touch-grass test nap`
- “Pause reminders for 30 minutes” → `touch-grass snooze 30`

For a companion folder, accept `.gif`, `.webp`, `.png`, `.jpg`, or `.jpeg` files named after actions: `water`, `stretch`, `snack`, `walk`, `eyes`, and `nap`. Missing actions fall back to the action icon. Do not invent asset paths; inspect the supplied folder first when needed.

After a change, report the effective setting in plain language. If the user asks what is configured, use `touch-grass status --json`, `touch-grass config get`, `touch-grass reminders list`, or `touch-grass companions list` as appropriate.

Touch Grass is local-only. Do not add network access, upload activity data, or read transcripts to configure it.

Native `agent` delivery is the default. When `touch-grass test <id>` returns a reminder, present that reminder directly to the user. Do not claim that native agent reminders can render animated GIFs. Cat animation is available only in optional `popup` delivery mode.
