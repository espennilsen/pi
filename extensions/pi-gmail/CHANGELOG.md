# Changelog

## Unreleased

### Added

- Multi-account support: configure multiple accounts under `settings.json` (`accounts` map and `defaultAccount`), connect tokens independently per account (`gmail-tokens-[account].json`), and pass `account` option to the `gmail` tool (closes #209)
- `/gmail-switch [account]` command to switch active Gmail account or list accounts when run without arguments
- `/gmail-accounts` command to list all configured and connected accounts with their authentication status
- `/gmail-auth [account]` and `/gmail-logout [account]` commands for managing individual accounts without disconnecting others
- `readOnly` setting to disable `send` and `send_draft` actions while preserving inbox and draft access

### Changed

- Email notification polling now dispatches notifications via `channel:send` with `{ route, text, source: "pi-gmail" }` payload to align with pi-channels

### Fixed

- Authenticated email address detection in `fetchUserEmail` now queries the Gmail `users/me/profile` endpoint (covered by `gmail.readonly`), resolving `unknown` email statuses on new authentications
- `loadTokens` reads fresh token state from disk to avoid stale in-memory cached tokens across account switches

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
