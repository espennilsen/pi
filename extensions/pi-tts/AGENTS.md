---
name: pi-tts
description: Text-to-speech extension for pi — generates WAV audio via a local TTS server
---

## Overview

Single-responsibility extension that wires a local TTS server into pi. The LLM gets a `generate_tts` tool for converting text to speech; the TUI gets a `/tts` command for quick inline speech generation. No database, no web UI — just a thin fetch client over the TTS REST API.

**Stack:** TypeScript · Local TTS Server REST API

## Architecture

Flat extension layout with one file per concern. Voice IDs are mapped to file paths in `voices.ts`. The TTS client handles HTTP communication, timeouts, and file saving.

## Key Files

- `index.ts` — Extension entry point. Registers the tool and `/tts` command. Loads settings on session_start, cleans up temp files on session_shutdown.
- `tool.ts` — Registers the `generate_tts` LLM tool with TypeBox schema; formats results. Receives config via getter functions so settings changes are picked up dynamically.
- `tts-client.ts` — TTS server API client (`fetch`-based). Handles request building, abort signal propagation (timeout + framework cancellation), error parsing, and WAV file saving to /tmp.
- `voices.ts` — Voice ID to file path mapping. Add new voices here.
- `settings.ts` — Loads `baseUrl` and `timeoutMs` from pi settings.json (global + project), falling back to defaults.

## Tools

- `generate_tts` — Generate speech audio from text. Params: `text` (required), `language_id` (default "en"), `voice_id` (e.g. "espen", optional). Returns `{ file_path, mime_type, size_bytes }`.

## Commands

- `/tts <text>` — Quick speech from the TUI. Supports `--voice <name>` prefix.

## Voice Mapping

| Voice ID  | File Path                      |
|-----------|--------------------------------|
| `espen`   | `/opt/tts/voices/espen.wav`     |

To add a new voice, edit `voices.ts` and add an entry to `VOICE_MAP`.

## Events

- Emits: log events via pi event bus
- Listens: session_start (loads settings), session_shutdown (cleans up temp files)

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

## Cancellation & Cleanup

- The `generate_tts` tool forwards the framework's abort `signal` to the HTTP fetch, so cancelled tool calls abort the network request promptly.
- `AbortSignal.any()` combines the timeout AbortController with the framework signal — either one triggers cancellation.
- If the signal fires before file write, the response is discarded instead of written to /tmp.
- Temp WAV files are tracked and deleted on `session_shutdown`.

## Conventions

- WAV files saved to `/tmp/tts-<uuid>.wav` and cleaned up on session shutdown.
- 30-second default timeout with clear abort error messages.
- Voice IDs normalized to lowercase for case-insensitive matching.
- Unknown voice_id returns a friendly error listing available voices.
- Non-200 responses include up to 2KB of response body in error details.