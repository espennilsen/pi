---
name: herdr-setup
description: Use when installing, updating, configuring, or troubleshooting Herdr, including missing commands, PATH errors, version differences, or Pi integration setup.
---

# Herdr Setup

Use the installed binary as the source of truth. Do not assume a command or flag from a different version exists.

## Inspect first

```bash
command -v herdr
herdr --version
herdr --help
herdr integration status
```

If `herdr` is absent, explain that it supports Linux and macOS. On Windows, the native preview installer is available; use WSL only if the native preview is unsuitable. Ask before running either upstream installer:

```powershell
irm https://herdr.dev/install.ps1 | iex
```

```bash
curl -fsSL https://herdr.dev/install.sh | sh
```

After installation, start a new shell if PATH has not refreshed, then rerun `herdr --version`.

## Integrate Pi

Inspect integration state before changing it:

```bash
herdr integration status
```

Install or update the Pi integration only when requested:

```bash
herdr integration install pi
```

Use `herdr integration status --outdated-only` to identify stale integrations. Do not remove an integration without confirmation.

## Updates and configuration

- Use `herdr update` only when the user asks to update.
- Use `herdr --default-config` to inspect defaults before editing configuration.
- Treat `HERDR_CONFIG_PATH`, `HERDR_SESSION`, and `HERDR_SOCKET_PATH` as explicit overrides; report their values before troubleshooting a surprising target/session.

## Command or version mismatch

1. Stop guessing after an unknown-command or unknown-flag error.
2. Run `herdr --help`, then `<known-group> --help` for the installed command tree.
3. Read [the upstream docs fallback](references/upstream-docs.md), selecting the installed release version when available.
4. If the installed help and matching version docs disagree, prefer installed help and report the discrepancy.

## Safety

`herdr server stop`, `session stop`, `session delete`, and `workspace/tab/pane close` affect live work. List or inspect state first and ask for confirmation before running them.
