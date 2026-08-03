# Changelog

## [Unreleased]

### Added
- Dual-mode peer authentication negotiation for legacy API keys, OAuth 2.0 client credentials, and capability-gated OAuth+mTLS
- Fail-closed modern-only skill policy, Agent Card auth capability publication, and redacted structured authentication logs
- `/a2a apikey` command to show the current effective local API key

### Changed
- Auto-generate `local.apiKey` for external binds when `hub.url` is configured, even if `local.requireApiKey` is unset

### Fixed
- Warn when `local.requireApiKey` auto-generates a local API key without hub config, so users know to recover it via `/a2a apikey`

## [0.4.0] - 2026-05-08

### Added
- `bindInterface` config option to bind to and advertise a specific network interface
- Auto-detect publicUrl IP when `bind: "0.0.0.0"` instead of defaulting to localhost
- `buildServerConfig()` helper that returns both bind address and publicUrl
- `owner` config field for agent owner name/email (displayed in hub UIs)

### Changed

- `bindInterface` now binds to the specified interface's IP (not just advertising it)
- Migrated from `@mariozechner/*` to `@earendil-works/*` package scope

### Fixed
- Documentation clarified that `bindInterface` binds to the interface, not just advertises it

