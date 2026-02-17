# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-02-17 (ffa6973)

### Added

- `/context` command with visual hexagon bar for context window usage.
- Category breakdown: system prompt, tools, custom agents, skills, messages.
- Per-item token detail lists for tools, agents, and skills.
- Color-coded output (blue, cyan, magenta, yellow, green, gray, red).
- Autocompact buffer visualization pinned to bottom row of hexagon grid.

### Fixed

- Estimated usage no longer shows 0% when API token count is unavailable; falls back to sum of category estimates.
- Category token counts now sum to the header total — system prompt computed as remainder to avoid double-counting mismatches.
- Removed misleading percentage from autocompact buffer line.
