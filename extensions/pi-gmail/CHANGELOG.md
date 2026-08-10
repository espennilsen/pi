# Changelog

## Unreleased

## [0.3.1] - 2026-08-10

### Changed

- Publish the finalized 0.3.0 release notes in the package tarball

## [0.3.0] - 2026-08-10

### Fixed

- `/gmail-auth` now discovers a running pi-webserver, refreshes the OAuth callback origin after manual server startup, uses shell-free browser launchers, and always provides a clickable, copyable local URL fallback
- Authentication now accurately asks users to start pi-webserver when no callback server is running and directs unconfigured users to `settings.json` rather than unsupported environment variables

### Changed

- Migrated from `@mariozechner/*` to `@earendil-works/*` package scope

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-04-26

### Changed

- `/gmail-status` command handler now forwards the `source` field for web/mobile result routing

## [0.2.0] - 2026-03-06

### Changed

- **BREAKING:** `env:VAR_NAME` substitution in settings is no longer supported. Set `clientId` and `clientSecret` directly in `settings.json` instead of using `"env:GMAIL_CLIENT_ID"` references.
- Web UI setup instructions updated to show `settings.json` configuration directly (no more environment variable references)

### Fixed

- Trash operation now handles per-message failures gracefully — reports partial success instead of failing the entire batch
- Logout form body parsing no longer destroys the request socket on oversized payloads; returns HTTP 413 instead

### Removed

- `resolveEnv()` utility function (no longer needed after removing `env:` pattern support)

## [0.1.0] - 2026-02-17 (7839f93)

### Added

- Initial release.
