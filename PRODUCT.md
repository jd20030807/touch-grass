# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

People using Codex or Claude Code for long, absorbing coding sessions who want gentle help taking healthy breaks without leaving their local workflow.

## Product Purpose

Touch Grass notices sustained coding-agent activity and surfaces small local reminders for water, movement, eye rest, food, and bedtime. Success means the reminders are useful and noticeable without becoming another dashboard, account, or source of interruption.

## Positioning

Touch Grass is configured through ordinary conversation with the coding agent, but its timing, preferences, activity state, popup, and animated cat assets remain entirely on the user's computer.

## Operating Context

- Installed as one local plugin for Codex and Claude Code Desktop, CLI, and supported IDE hosts.
- Agent lifecycle hooks maintain opaque, expiring session leases; they do not provide elapsed activity time.
- The macOS companion counts only while the matching host is frontmost and the operating system reports recent input. Codex Desktop and Claude Desktop use exact bundle identifiers; terminals and editors are compatibility hosts for Claude Code CLI/IDE sessions. It uses aggregate idle age without recording keys, clicks, pointer locations, window titles, prompts, transcripts, source code, tool arguments, or tool results.
- Claude Desktop's Chat, Cowork, and Code tabs share one application identity. A live Code lease gates counting, but Touch Grass does not inspect the selected internal tab.
- A local desktop companion owns the floating reminder window outside coding-agent GUI sandboxes.
- Activity-based reminders consume cumulative local presence time and start fresh after the user has been away for a while; agent-only tool execution does not keep them moving.
- Clock-based snack and bedtime reminders appear only when the user is present in the coding app near their scheduled time.

## Capabilities and Constraints

- Six built-in reminder groups: water, stretch, snack, walk, eye rest, and bedtime.
- Bedtime has two stages: a wind-down reminder before the configured bedtime and a bedtime reminder at that time. It is not a nap reminder.
- Each reminder group has its own cadence rather than participating in a random rotation.
- Defaults: eye rest every 20 active minutes; water every 30 active minutes; stretch every 60 active minutes; walk every 120 active minutes; snacks at 10:30 AM and 3:30 PM; bedtime at 10 PM with a 20-minute wind-down.
- Quiet hours are off initially. Users can change timing, quiet periods, snooze, enablement, custom reminder types, and cats through natural-language requests.
- Every reminder requires a matching animated cat GIF or WebP. Development may show an explicit placeholder, but the public release requires two complete bundled cat packs based on the user's real-life model cats.
- No settings website, hosted service, telemetry, account, API key, or network dependency.

## Brand Commitments

- Product name: Touch Grass.
- Reminder banners are compact, simple, warm, and comparable in footprint to a desktop message-notification banner.
- Cat animation is the focal visual, not optional decoration.
- User-facing language is natural and reassuring; backend setting names and raw configuration are hidden unless developer diagnostics are explicitly requested.

## Evidence on Hand

- Working local Node reminder engine, Codex and Claude Code hooks, and macOS popup companion in this repository.
- Built-in action icons are development fallbacks only.
- Real cat reference media and final cat animations have not been supplied and must not be fabricated or substituted.

## Product Principles

1. Local means local: no network access or activity-content collection.
2. Helpful rhythm, not random interruption: each kind of break follows its own understandable schedule.
3. Conversation is the control panel: configuration should feel like stating a preference, not editing software fields.
4. Warm but unobtrusive: reminders should be glanceable, compact, and easy to dismiss.
5. The cat action is part of the reminder's meaning and must match it.

## Accessibility & Inclusion

The popup must preserve readable contrast, honor reduced-motion preferences, expose meaningful text and controls to assistive technology, and never rely on the animation alone to communicate the reminder.
