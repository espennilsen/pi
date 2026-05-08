# Changelog

## [0.2.0] - 2026-05-08

### Changed

- Migrated from `@mariozechner/*` to `@earendil-works/*` package scope

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-04-26

### Changed

- Event bus command handlers now forward the `source` field, allowing web/mobile clients to route `command_result` events to the originating UI
