---
name: pi-gondolin
description: Pi extension that runs file and shell tools inside a Gondolin micro-VM sandbox
---

## Overview

`pi-gondolin` overrides Pi's built-in `read`, `write`, `edit`, and `bash` tools so they execute inside a Gondolin micro-VM. It is secure by default: when the extension is loaded, sandboxing is enabled unless disabled with `--no-gondolin` or `settings.json`.

## Key Files

- `index.ts` — Extension entry point, tool overrides, VM lifecycle, settings resolution.
- `README.md` — Usage and configuration.
- `CHANGELOG.md` — Release notes.

## Design Notes

- The current working directory is mounted at the same absolute path inside the VM.
- Extra mounts are also mounted at their configured guest paths; simple string mounts use the same host and guest path.
- Never fall back to host execution while Gondolin is enabled. VM startup failures should surface as tool errors.
- `--no-gondolin` is the emergency opt-out flag.

## Validation

Run from this directory:

```bash
npm run typecheck
```
