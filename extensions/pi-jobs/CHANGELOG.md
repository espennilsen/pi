# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Event bus command handlers now forward the `source` field, allowing web/mobile clients to route `command_result` events to the originating UI

## [0.1.0] - 2026-02-17 (7839f93)

### Added

- Initial release.
