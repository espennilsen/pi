# Changelog

All notable changes to `@e9n/pi-gondolin` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-07

### Added

- Initial Pi extension for running `read`, `write`, `edit`, and `bash` inside a Gondolin micro-VM.
- Secure-by-default behavior with `--no-gondolin` opt-out.
- Same-absolute-path cwd mounting inside the VM.
- Extra mount support via `--gondolin-mounts` and `settings.json`.
- `settings.json` support for `enabled`, `eagerStart`, and `mounts`.
- User `!` bash command interception so manual shell commands use the VM when sandboxing is enabled.
