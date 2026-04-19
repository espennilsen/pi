---
name: pi-tts
description: Text-to-speech extension for pi — generates WAV audio via a local TTS server
---

## Overview

Single-responsibility extension that wires a local TTS server into pi. The LLM gets a `generate_tts` tool for converting text to speech; the TUI gets a `/tts` command for quick inline speech generation. No database, no web UI — just a thin fetch client over the TTS REST API.

**Stack:** TypeScript · Local TTS Server REST API

## Architecture

Flat `src/` layout with one file per concern. Voice IDs are mapped to file paths in `voices.ts`. The TTS client handles HTTP communication, timeouts, and file saving.

## Key Files

- `src/index.ts` — Extension entry point. Registers the tool and `/tts` command.
- `src/tool.ts` — Registers the `generate_tts` LLM tool with TypeBox schema; formats results.
- `src/tts-client.ts` — TTS server API client (`fetch`-based). Handles request building, error parsing, and WAV file saving to /tmp.
- `src/voices.ts` — Voice ID to file path mapping. Add new voices here.
- `src/logger.ts` — Extension logger (delegates to pi-logger via event bus).

## Tools

- `generate_tts` — Generate speech audio from text. Params: `text` (required), `language_id` (default "en"), `voice_id` (e.g. "espen", optional). Returns `{ file_path, mime_type, size_bytes }`.

## Commands

- `/tts <text>` — Quick speech from the TUI. Supports `--voice <name>` prefix.

## Voice Mapping

| Voice ID  | File Path                      |
|-----------|--------------------------------|
| `espen`   | `/opt/tts/voices/espen.wav`     |

To add a new voice, edit `src/voices.ts` and add an entry to `VOICE_MAP`.

## Events

- Emits: log events via pi event bus
- Listens: session_start

## Settings

- `baseUrl` — TTS server base URL (default: `http://192.168.0.27:8001`)
- `timeoutMs` — Request timeout in milliseconds (default: `30000`)

Configure in settings.json:
```json
{
  "pi-tts": {
    "baseUrl": "http://192.168.0.27:8001",
    "timeoutMs": 30000
  }
}
```

## Database

None.

## Conventions

- WAV files saved to `/tmp/tts-<uuid>.wav` (cleaned by OS).
- 30-second default timeout with clear abort error messages.
- Voice IDs normalized to lowercase for case-insensitive matching.
- Unknown voice_id returns a friendly error listing available voices.
- Non-200 responses include up to 2KB of response body in error details.