---
name: touch-grass
description: Configure and test local cat-GIF break reminders while using Codex or Claude Code. Use when the user asks to change reminder timing, enable or disable break types, add a custom reminder or cat, snooze reminders, see examples, or preview a reminder.
---

# Touch Grass

Translate the user's request into the bundled `touch-grass` CLI. Prefer the executable named `touch-grass` when it is on `PATH`. Otherwise run `node <plugin-root>/bin/touch-grass.mjs`, where `<plugin-root>` is the plugin directory containing this skill under `skills/touch-grass/`.

At the start of every Touch Grass interaction, run `touch-grass welcome`. It prints the first-use explanation only once. When it prints text, show that text before the requested outcome. When it prints nothing, continue normally.

Do not edit `~/.touch-grass/config.json` directly. The CLI validates and atomically saves changes.

The product vocabulary is intentionally human. Do not expose implementation labels such as `idle reset`, `delivery`, `order`, `activeMs`, state files, or raw configuration unless the user explicitly asks for developer diagnostics. When the user asks what they can change, run `touch-grass settings` and present its natural-language examples rather than a settings inventory.

Common requests:

- “Remind me every 35 minutes” → `touch-grass config set interval 35`
- “Keep quiet from 10 PM to 8 AM” → `touch-grass config set quiet-hours 22:00-08:00`
- “Turn snack reminders off” → `touch-grass reminders disable snack`
- “Turn naps back on” → `touch-grass reminders enable nap`
- “Add a breathing reminder using this GIF” → `touch-grass reminders add breathing --title "Breathing break" --message "Take five slow breaths." --gif "/absolute/path/breathe.gif" --icon "◌"`
- “Use my cat Juniper from this folder” → `touch-grass companions add juniper --name "Juniper" --dir "/absolute/path"`
- “Rotate my cats” → `touch-grass companions use rotate`
- “What can I customize?” → `touch-grass settings`
- “Pause reminders for 30 minutes” → `touch-grass snooze 30`

For a companion folder, require animated `.gif` or `.webp` files named `water`, `stretch`, `snack`, `walk`, `eyes`, and `nap`. All six are required because every reminder must have a matching cat animation. Do not invent asset paths; inspect the supplied folder first when needed.

After a change, acknowledge the outcome naturally rather than reporting a setting mutation. Good responses include:

- “Okay, I'll nudge you about every 40 minutes while you're coding.”
- “Okay, I won't remind you about snacks anymore.”
- “Nap reminders are back in the mix.”
- “I'll stay quiet between 10 PM and 8 AM.”
- “Mochi is ready to bring your reminders.”

Do not say “setting X changed to Y,” dump command output, or enumerate backend fields. If a command returns structured details, translate only the user-visible outcome.

Touch Grass is local-only. Do not add network access, upload activity data, or read transcripts to configure it.

Reminders always open as local popup banners. `touch-grass test <id>` launches one immediately. The banner may show an explicit art placeholder during development, but a public release is not ready until two complete bundled cat-GIF packs pass `touch-grass doctor`.

Never simulate a reminder in chat. Do not use plain text, emoji, Markdown images, or wording such as “the reminder is showing now” as a substitute for the popup. If the user explicitly asks for a development preview, run `touch-grass test <id>` and only claim it opened after the command exits successfully. The popup itself is the reminder; do not repeat its reminder text in chat. Do not offer previewing as a customization example.

On macOS, reminders are displayed by the local `Touch Grass.app` companion because coding-agent sandboxes cannot own reliable desktop windows. If the CLI says the popup helper is not running, say that plainly and direct the user to open the locally built app. Never turn that failure into a chat reminder.
