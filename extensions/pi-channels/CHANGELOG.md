# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-02-19 (7442720)

### Added

- Support custom JSON payloads in webhook adapter via `notify` tool
- Add explicit webhook payload controls: `payloadMode` (`envelope`/`raw`), `rawBody`, and per-message webhook overrides (`method`, `contentType`)

### Fixed

- Guard `notify` JSON parsing and return graceful `Invalid JSON` errors instead of throwing
- Remove metadata side-channel payload switching (`metadata["json"]`) in favor of typed fields
- Allow raw JSON sends without injecting empty `text` into outgoing messages
- Omit request body for webhook `GET`/`HEAD` requests to avoid undici runtime errors
- Document `contentType` precedence over `headers["Content-Type"]` for webhook config

## [0.1.0] - 2026-02-17 (7839f93)

### Added

- Initial release.
