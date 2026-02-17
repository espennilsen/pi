---
name: pi-brave-search
description: Web search extension for pi via Brave Search API — provides a `search` LLM tool and `/search` TUI command
---

## Overview

Single-responsibility extension that wires the Brave Search API into pi. The LLM gets a `search` tool for real-time web queries; the TUI gets a `/search` command for quick inline searches. No database, no web UI — just a thin fetch client over the Brave REST API.

**Stack:** TypeScript · Brave Search API v1 REST

## Architecture

Flat `src/` layout with one file per concern. Settings are loaded fresh on each `session_start` from the global/project settings.json hierarchy.

## Key Files

- `src/index.ts` — Extension entry point. Wires settings, registers the tool and `/search` command.
- `src/settings.ts` — Reads `"pi-brave-search"` block from settings.json (global + project merge).
- `src/tool.ts` — Registers the `search` LLM tool with TypeBox schema; formats results as markdown.
- `src/search.ts` — Brave Web Search API client (`fetch`-based, no SDK). Handles params, error parsing, and result mapping.
- `src/logger.ts` — Extension logger (delegates to pi-logger via event bus).

## Tools

- `search` — Query the web via Brave Search API. Params: `query` (required), `count` (1–20), `freshness` (pd/pw/pm/py/date-range), `country` (2-letter), `search_lang`. Returns ranked results as markdown (title, URL, description, age).

## Commands

- `/search <query>` — Quick web search from the TUI; prints results as a notification.

## Events

- Emits: none
- Listens: none

## Settings

- `apiKey` — Brave Search API subscription token (required; get from brave.com/search/api)
- `defaultCount` — Default result count, 1–20 (default: `5`)
- `safesearch` — `"off"` | `"moderate"` | `"strict"` (default: `"moderate"`)

## Database

None.

## Conventions

- No SDK dependency — direct `fetch` to `https://api.search.brave.com/res/v1/web/search`.
- Auth via `X-Subscription-Token` request header.
- Settings merged global → project; project settings win.
- Warns (log level WARNING) on `session_start` if `apiKey` is missing rather than throwing.
- Tool returns friendly error strings instead of throwing when misconfigured.
