---
name: pi-dotenv
description: DEPRECATED no-op extension — safe to remove
---

## Overview

**This extension is deprecated and does nothing.** It was originally responsible for loading `.env` files from the working directory into `process.env` so that other extensions could use `env:VAR_NAME` references in settings. All extensions now read configuration directly from `settings.json`, making this extension unnecessary. It is kept only for backwards compatibility with existing `extensions.json` lists that reference it.

## Key Files

- `src/index.ts` — Exports a no-op default function. Zero logic.

## Conventions

- Safe to remove from your `extensions` list; removing it has no effect.
- Do not add new functionality here — create a new extension instead.
