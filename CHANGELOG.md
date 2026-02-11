# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add `pi-calendar` extension — calendar tool, web dashboard at `/calendar`, event recurrence, and reminder notifications via pi-channels
- Add `pi-dotenv` extension — loads `.env` / `.env.local` files from agent home into `process.env` on session start
- Add `pi-heartbeat` extension — periodic health checks via isolated subprocesses with active-hours scheduling and alerting
- Add `pi-jobs` extension — agent run telemetry and cost tracking with web dashboard at `/jobs`, tracks TUI, cron, heartbeat, and subagent runs
- Add `pi-memory` extension — persistent memory system with `MEMORY.md` long-term storage, daily logs, full-text search, and system prompt injection
- Add `pi-npm` extension — npm workflow tool with 15 actions (install, publish, version, audit, etc.)
- Add `pi-projects` extension — auto-discovers git repos, tracks branch/dirty/ahead-behind status, web dashboard at `/projects`
- Add `pi-subagent` extension — parallel task delegation with single, parallel, and chain execution modes
- Add `pi-vault` extension — Obsidian vault tool with 16 actions and health dashboard at `/vault`, supports Local REST API and filesystem fallback
- Add `pi-workon` extension — project context switching with stack detection, `AGENTS.md` scaffolding, and td integration
- Add `pi-webnav` extension — unified navigation shell for pi-webserver with top nav bar, iframe layout, and hash-based routing
- Add web UI for pi-cron at `/cron` with job list, status, and manual run
- Add dashboard page to pi-personal-crm
- Add `npm` skill for package management workflows
- Add `readme-reviewer` skill for generating and reviewing README files
- Add `handoff` skill for generating continuation prompts for fresh agent sessions
- Add `changelog-generator` skill for producing Keep a Changelog formatted changelogs from git history
- Add `.env.example` with all supported environment variables
- Add `settings.json.example` with configuration blocks for all extensions

### Changed

- Expand README with comprehensive documentation for all 17 extensions and 4 skills
- Update `settings.json.example` with config blocks for pi-heartbeat, pi-jobs, pi-memory, pi-projects, pi-subagent, and pi-workon
- Update pi-webserver to allow extensions to override `/` mount (dashboard now serves as fallback)
- Update pi-personal-crm web UI with improved layout and navigation
- Update pi-kysely README and settings for clarity

### Removed

- Remove `sample-tools.ts` example extension
- Remove pi-cron runtime files (`pi-cron.db-shm`, `pi-cron.db-wal`) from tracking

### Fixed

- Fix `.gitignore` patterns to properly exclude runtime databases and lock files
