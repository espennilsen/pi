# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-04-19

### Added

- `generate_tts` LLM tool: text-to-speech via local TTS server
- `/tts` TUI command for quick speech generation
- Voice mapping: "espen" → `/opt/tts/voices/espen.wav`
- WAV output saved to `/tmp/tts-<uuid>.wav`
- 30-second request timeout with clear error messages
- Error handling: non-200 responses include status code + up to 2KB of response body