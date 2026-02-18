# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-02-18

### Added

- Initial release
- OpenRouter provider with OAuth PKCE authentication via `/login openrouter`
- Dynamic model discovery from OpenRouter API with local caching
- Glob-pattern model filtering via `pi-openrouter.models` setting (default: all models)
- `/openrouter refresh` command to fetch latest models from API
- Merges with built-in openrouter provider for seamless authentication
