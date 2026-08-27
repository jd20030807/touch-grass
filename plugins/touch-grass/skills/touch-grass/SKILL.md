---
name: touch-grass
description: Configure local cat-GIF break reminders while using Codex or Claude Code. Use when the user asks to change a reminder cadence or clock time, enable or disable break types, set bedtime or quiet hours, add a custom reminder or cat, snooze reminders, or see personalization examples.
---

# Touch Grass

Translate the user's request into the bundled `touch-grass` CLI. Prefer the executable named `touch-grass` when it is on `PATH`. Otherwise run `node <plugin-root>/bin/touch-grass.mjs`, where `<plugin-root>` is the plugin directory containing this skill under `skills/touch-grass/`.

At the start of every Touch Grass interaction, run `touch-grass welcome`. It prints the first-use explanation only once. When it prints text, show that text before the requested outcome. When it prints nothing, continue normally.

Present `welcome` and `settings` output verbatim. Do not add companion names, rotation behavior, popup-delivery details, or other product facts to those introductions.

Do not edit `~/.touch-grass/config.json` directly. The CLI validates and atomically saves changes.

The product vocabulary is intentionally human. Do not expose implementation labels such as `idle reset`, `delivery`, `order`, `activeMs`, state files, or raw configuration unless the user explicitly asks for developer diagnostics. When the user asks what they can change, run `touch-grass settings` and present its natural-language examples rather than a settings inventory.

Each reminder has its own schedule. Do not translate a reminder-specific request into one global interval.

Common requests:

- “Remind me to walk around every 40 minutes” → `touch-grass reminders interval walk 40`
- “Remind me to drink water every 45 minutes” → `touch-grass reminders interval water 45`
- “Move my snack reminders to 11 AM and 4 PM” → `touch-grass reminders times snack 11:00,16:00`
- “My bedtime is 11:30 PM; warn me 30 minutes before” → `touch-grass reminders bedtime 23:30 --wind-down 30`
- “Keep quiet from 10 PM to 8 AM” → `touch-grass config set quiet-hours 22:00-08:00`
- “Turn snack reminders off” → `touch-grass reminders disable snack`
- “Turn bedtime reminders back on” → `touch-grass reminders enable bedtime`
- “Add a breathing reminder using this GIF” → `touch-grass reminders add breathing --title "Breathing break" --message "Take five slow breaths." --gif "/absolute/path/breathe.gif" --interval 60`
- “Use my cat Juniper from this folder” → `touch-grass companions add juniper --name "Juniper" --dir "/absolute/path"`
- “Rotate my cats” → `touch-grass companions use rotate`
- “What can I customize?” → `touch-grass settings`
- “Pause reminders for 30 minutes” → `touch-grass snooze 30`

For a companion folder, require animated `.gif` or `.webp` files named `water`, `stretch`, `snack`, `walk`, `eyes`, and `bedtime`. Those six cover every reminder: the bedtime animation serves both the wind-down and bedtime stages, and the snack animation covers lunch and dinner unless the folder also has `lunch` and `dinner` files of its own. Do not invent asset paths; inspect the supplied folder first when needed.

After a change, acknowledge the outcome naturally rather than reporting a setting mutation. Good responses include:

- “Okay, I'll remind you to walk around every 40 minutes while you're coding.”
- “Okay, I won't remind you about snacks anymore.”
- “Bedtime reminders are back.”
- “I'll stay quiet between 10 PM and 8 AM.”
- “Mochi is ready to bring your reminders.”

Do not say “setting X changed to Y,” dump command output, or enumerate backend fields. If a command returns structured details, translate only the user-visible outcome.

Touch Grass is local-only. Do not add network access, upload activity data, or read transcripts to configure it.

When the user asks how activity detection works, explain it in plain language: agent hooks only keep an opaque local session lease alive; the macOS companion counts time when the matching host is frontmost and the operating system reports recent input. Codex Desktop and Claude Desktop are first-class hosts; supported terminals and editors are fallback hosts for Claude Code CLI/IDE sessions. It queries only how long the computer has been idle. It does not install a keylogger or mouse listener, and it never records keys, clicks, pointer coordinates, window titles, prompts, code, tool inputs, or tool outputs. Agent-only work does not keep the timer moving after recent user input expires. A longer absence begins a fresh coding stretch. If asked about Claude Desktop's Chat, Cowork, and Code tabs, disclose that one application identity covers all three: a live Code lease is required, but the selected internal tab is not inspected.

Reminders always open as compact local popup banners. The banner shows the explicit action-icon fallback only if a matching animation cannot be loaded.

Never simulate a reminder in chat. Do not use plain text, emoji, Markdown images, or wording such as “the reminder is showing now” as a substitute for the popup. If the user explicitly asks for a development preview, run `touch-grass test <id>` and only claim it opened after the command exits successfully. Use `touch-grass test wind-down` for the wind-down stage and `touch-grass test bedtime` for bedtime. When the user names a companion for a preview, add `--companion <id>`; for example, “open a wind-down reminder on Nian” maps to `touch-grass test wind-down --companion nian`. The preview override is temporary and must not change their saved companion preference. The popup itself is the reminder; do not repeat its reminder text in chat. Do not offer previewing as a customization example.

On macOS, reminders are displayed by the local `Touch Grass.app` companion because coding-agent sandboxes cannot own reliable desktop windows. If the CLI says the popup helper is not running, say that plainly and direct the user to open the locally built app. Never turn that failure into a chat reminder.
