# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- OpenAI transcription now automatically uses pi's built-in OpenAI authentication if available (no need for explicit `apiKey` in config)
- Users who have run `/login openai` can enable transcription without additional configuration

### Changed

- **BREAKING:** Environment variables referenced via `"env:VAR_NAME"` now require `PI_` prefix for security (e.g. `"env:PI_TELEGRAM_BOT_TOKEN"`)
- Adapter factories are now async to support modelRegistry API key resolution
- Transcription providers use static `create()` factory methods instead of constructors

### Security

- Enforce `PI_` prefix for environment variables to prevent accidental exposure of system-wide credentials

## [0.1.1] - 2026-02-19 (7442720)

### Added

- Support custom JSON payloads in webhook adapter via `notify` tool
- Add explicit webhook payload controls: `payloadMode` (`envelope`/`raw`), `rawBody`, and per-message webhook overrides (`method`, `contentType`)

### Fixed

- Guard `notify` JSON parsing and return graceful `Invalid JSON` errors instead of throwing
- Remove metadata side-channel payload switching (`metadata["json"]`) in favor of typed fields
- Allow raw JSON sends without injecting empty `text` into outgoing messages
- Omit request body for webhook `GET`/`HEAD` requests to avoid undici runtime errors
- Omit `Content-Type` for bodyless `GET`/`HEAD` webhook requests
- Prevent silent raw payload drops by rejecting `GET`/`HEAD` requests that include `json/rawBody`
- Add `HEAD` method support to the `notify` tool
- Document `contentType` precedence over `headers["Content-Type"]` for webhook config

## [0.1.0] - 2026-02-17 (7839f93)

### Added

- Initial release.
