# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org).

## [0.2.0] - 2026-04-26

### Added

- **Slash command support** — typing `/command` in the chat input now routes through the correct handler instead of sending literal text to the LLM:
  - Extension commands (e.g. `/workon`, `/web`, `/compact`) are dispatched via the event bus (`command:<name>`)
  - Skills (e.g. `/skill:handoff`) are expanded from disk and sent as a user message with arguments appended
  - Prompt templates (e.g. `/implement`) are expanded with argument substitution (`$1`, `$@`, `$ARGUMENTS`) and sent as a user message
  - Unknown `/commands` fall through as literal text
- **`GET /api/mobile/chat/commands`** endpoint — returns available slash commands from `pi.getCommands()` for autocomplete UIs
- **`command_dispatched` SSE event** — broadcast when a slash command is routed, so mobile UIs can show feedback

## [0.1.0] - 2026-02-17

### Added

- Initial release.