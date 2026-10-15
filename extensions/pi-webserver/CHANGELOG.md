# Changelog

## Unreleased

### Added

- Configurable listener `host` (default `127.0.0.1`) for autostart and manual start/restart, with a cleartext HTTP warning for non-loopback access

### Fixed

- Bracket IPv6 addresses in request and discovery URLs and advertise loopback URLs for wildcard listeners

## [0.3.2]

### Fixed

- Include `web-info.ts` in the published package (fixes #217: extension failed to load with `Cannot find module ./web-info.ts`)

## [0.3.1] - 2026-08-10

### Changed

- Publish the finalized 0.3.0 release notes in the package tarball

## [0.3.0] - 2026-08-10

### Added

- Added a synchronous `web:info` event reply with the actual listening port and URL for extension discovery

### Changed

- Migrated from `@mariozechner/*` to `@earendil-works/*` package scope

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-04-26

### Added

- `/chat/commands` API endpoint to list available slash commands for autocomplete UIs
- `broadcast()` SSE helper for emitting events to connected dashboard clients

## [0.1.0] - 2026-02-17 (7839f93)

### Added

- Initial release.
