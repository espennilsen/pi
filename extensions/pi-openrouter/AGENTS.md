---
name: pi-openrouter
description: OpenRouter provider with OAuth PKCE and dynamic model filtering
---

## Overview

Registers OpenRouter as a provider in pi with OAuth PKCE authentication (shows in `/login`) and dynamic model discovery from OpenRouter's API. Models are filtered by user-configurable glob patterns.

## Architecture

```
src/
├── index.ts      # Entry point: provider registration, session lifecycle, /openrouter command
├── oauth.ts      # PKCE generation and OAuth login flow
├── models.ts     # Model fetching, caching, filtering, and mapping to pi format
└── settings.ts   # Settings resolution via SettingsManager
```

## Key Design Decisions

- **No hardcoded model list** — models are fetched from OpenRouter's public API and cached locally
- **Permanent API key** — OpenRouter PKCE returns a permanent key (no refresh), stored in `auth.json`
- **Glob filtering** — settings use glob patterns (`anthropic/*`, `openai/gpt-5*`) to filter the 300+ model catalog
- **Cache-first init** — loads cached models synchronously at init, refreshes async on session_start
- **Re-registration** — calls `registerProvider` again on refresh to update the model list

## Settings

Key: `pi-openrouter` in `settings.json`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `models` | `string[]` | `["*"]` | Glob patterns for model IDs to include |

## Provider Config

- **Provider name:** `openrouter-oauth`
- **API:** `openai-completions` (OpenAI Chat Completions compatible)
- **Base URL:** `https://openrouter.ai/api/v1`
- **Auth header:** `Authorization: Bearer <key>`
- **Auth storage:** `~/.pi/agent/auth.json` under key `openrouter-oauth`
