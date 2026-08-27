# Changelog

## 0.1.2 - 2026-08-27

- Reclaim the shared schedule lock as soon as a killed hook could have left it behind, so a rare mid-write kill no longer blocks Codex and Claude Code reminders for ten seconds
- Label session leases with the app that actually fired the hook, so launching Codex from inside a Claude Code shell (or the reverse) credits presence to the right app
- Expire unknown-host presence leases after five minutes instead of thirty-five
- Explain in the README that installing on both Codex and Claude Code shares one schedule with no duplicate popups

## 0.1.1 - 2026-08-27

- Add a one-time install-success banner featuring both bundled companions in their original static artwork
- Clarify that automatic timing begins in a new task after the plugin hooks are reviewed

## 0.1.0 - 2026-08-26

- Initial local-first activity engine
- Codex and Claude Code marketplace/plugin packaging
- Water, stretch, snack, walk, eye-rest, and two-stage bedtime presets
- Independent active-time and clock-time schedules for each reminder group
- Local popup reminder banner with mandatory matching cat-GIF slots
- Natural-language customization and acknowledgements with no settings panel
- Chat-first configuration skill and custom companion import
- Public-release check requiring two complete bundled cat packs
- One-time first-use explanation and a guard against chat-only reminder simulation
- Native macOS popup companion with a private local reminder bridge
- Complete transparent six-action GIF packs for the real cats Nian and You
- Smoother eight-frame loops, with natural circle turns replacing the original walk cycles
- Stable two-axis registration, full-frame keyframe interpolation, and edge clearance for corrected eye-rest, stretch, and snack loops
- Explicit wind-down preview routing with temporary companion selection
- Independent random companion selection for every reminder instead of alternation
