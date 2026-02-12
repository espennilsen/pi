# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2026-02-12

### Added

- Add persistent RPC sessions to pi-channels chat bridge — each sender gets a long-lived `pi --mode rpc` subprocess with full conversation context across messages; configurable per-sender via `sessionRules` glob patterns (e.g. group chats stateless, private chats persistent), idle timeout auto-cleanup, crash auto-restart, and `/new` command to reset context
- Add advanced recurrence system to pi-calendar — daily/weekly/biweekly/monthly/yearly with custom intervals, day-of-week selection, month position patterns (e.g. "2nd Tuesday", "last Friday"), end conditions (never/count/date), exclusion dates, and per-occurrence overrides
- Add month view to pi-calendar — full month grid with event chips, today highlight, and click-to-create
- Add year view to pi-calendar — 3×4 mini-calendar grid with multi-color event dots, event count badges, and click-to-drill into month view
- Add table/agenda view to pi-calendar — grouped by day, only shows days with events, with relative date labels and recurrence badges
- Add `recurrence.ts` shared expansion engine to pi-calendar — generates concrete occurrence dates from recurrence rules, used by both reminders and tool
- Add `pi-logger` extension — centralized structured JSONL logging via the event bus
- Add structured `logger.ts` to every extension for consistent event-bus logging
- Add `pi-web-dashboard` extension — HTML dashboard landing page
- Add `git-project-status` skill for comprehensive repo status reports
- Add autostart, activeHours, route, and showOk settings to pi-cron
- Add web UI for pi-cron at `/cron` with job list, status, and manual run
- Add READMEs for pi-heartbeat, pi-jobs, pi-projects, pi-subagent, and pi-workon

### Changed

- Deprecate `pi-dotenv` — replaced with no-op; all config now via `settings.json`
- Refactor pi-vault, pi-kysely, and pi-webserver internals for cleaner code
- Replace detailed per-extension docs in README with summary table linking to each extension's own README
- Add disclaimer section to README
- Run pi-channels bridge subprocesses with `--no-extensions` for safety; add extensions config for bridge-safe loading
- Sanitize error messages before forwarding to Telegram users
- Update pi-webserver to allow extensions to override `/` mount (dashboard now serves as fallback)
- Update pi-personal-crm web UI with improved layout and navigation
- Update pi-kysely README and settings for clarity

### Removed

- Remove `.env.example` (no longer needed after pi-dotenv deprecation)
- Remove `settings.json` from repository (now gitignored)
- Remove Settings section and verbose extension docs from README

### Fixed

- Fix cron subprocesses crashing with EADDRINUSE by running with `--no-extensions`; add `extensions` setting to whitelist specific extensions for subprocess runs
- Fix `.gitignore` patterns to properly exclude runtime databases and lock files

## 2026-02-11

### Added

- Initial project commit — pi coding agent with extensions and skills architecture
- Add `pi-calendar` extension — calendar tool, web dashboard at `/calendar`, event recurrence, and reminder notifications via pi-channels
- Add pi-channels chat bridge — bidirectional agent interaction via Telegram and other adapters, with per-sender queues, typing indicators, and bot commands (`/start`, `/help`, `/abort`, `/status`, `/new`)
- Add pi-channels Telegram photo and document handling — downloads and passes attachments to the agent as files
- Add pi-heartbeat web UI dashboard at `/heartbeat` and REST API at `/api/heartbeat`
- Add `pi-heartbeat` extension — periodic health checks via isolated subprocesses with active-hours scheduling and alerting
- Add `pi-jobs` extension — agent run telemetry and cost tracking with web dashboard at `/jobs`, tracks TUI, cron, heartbeat, and subagent runs
- Add `pi-memory` extension — persistent memory system with `MEMORY.md` long-term storage, daily logs, full-text search, and system prompt injection
- Add `pi-npm` extension — npm workflow tool with 15 actions (install, publish, version, audit, etc.)
- Add `pi-projects` extension — auto-discovers git repos, tracks branch/dirty/ahead-behind status, web dashboard at `/projects`
- Add `pi-subagent` extension — parallel task delegation with single, parallel, and chain execution modes
- Add `pi-vault` extension — Obsidian vault tool with 16 actions and health dashboard at `/vault`, supports Local REST API and filesystem fallback
- Add `pi-workon` extension — project context switching with stack detection, `AGENTS.md` scaffolding, and td integration
- Add `pi-webnav` extension — unified navigation shell for pi-webserver with top nav bar, iframe layout, and hash-based routing
- Add autostart and port settings to pi-webserver
- Add dashboard page to pi-personal-crm
- Add `npm` skill for package management workflows
- Add `readme-reviewer` skill for generating and reviewing README files
- Add `handoff` skill for generating continuation prompts for fresh agent sessions
- Add `changelog-generator` skill for producing Keep a Changelog formatted changelogs from git history

### Removed

- Remove `sample-tools.ts` example extension
- Remove pi-cron runtime files (`pi-cron.db-shm`, `pi-cron.db-wal`) from tracking
