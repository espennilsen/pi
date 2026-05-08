# Changelog

## [0.4.0] - 2026-05-08

### Changed

- Migrated from `@mariozechner/*` to `@earendil-works/*` package scope

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org).

## [0.3.0] - 2026-04-26

### Added

- **Slash command support** — typing `/command` in the prompt bar now routes through the correct handler instead of sending literal text to the LLM:
  - Extension commands (e.g. `/workon`, `/web`, `/compact`) are dispatched via the event bus (`command:<name>`)
  - Skills (e.g. `/skill:handoff`) are expanded from disk and sent as a user message with arguments
  - Prompt templates (e.g. `/implement`) are expanded with argument substitution (`$1`, `$@`, `$ARGUMENTS`) and sent as a user message
  - Unknown `/commands` fall through as literal text
- **`GET /api/dashboard/commands`** endpoint — returns available slash commands from `pi.getCommands()` for autocomplete UIs
- **Autocomplete dropdown** — typing `/` shows a filtered list of commands with source badges (extension, skill, prompt) and keyboard navigation (Arrow keys, Tab, Enter, Escape)
- **`command_result` SSE event** — dashboard UI now receives and displays command results from event bus handlers

### Fixed

- Removed dead `command_dispatched` SSE broadcasts that no client handled
- `parseCommand()` is now correctly scoped in the `expand-and-send` code path (was previously only in `event-bus` block)
- Removed orphaned "Handle SSE command_dispatched events" comment

## [0.1.0] - 2026-02-17 (7839f93)

### Added

- Initial release.
