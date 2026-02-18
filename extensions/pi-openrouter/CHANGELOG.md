# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2025-02-18

### Added

- OpenRouter provider with OAuth PKCE authentication via `/login openrouter`
- Dynamic model discovery from OpenRouter API with local caching
- Glob-pattern model filtering via `pi-openrouter.models` setting
- Curated default model list (GPT-5.2, Claude Opus/Sonnet 4.6, Gemini 3, Minimax M2.5, Kimi K2.5)
- `/openrouter` command for status, model listing, and manual refresh
