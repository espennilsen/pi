# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-03-06

### Added

- `search` action with query text, type/priority/status/labels filters, sort, and limit
- `update` action to modify title, type, priority, description, labels, parent, and status
- `delete` action to remove tasks
- `focus` / `unfocus` actions for session-level task focus
- `filter_labels`, `filter_mine`, `filter_epic`, `sort`, and `limit` parameters for list/search
- `status` parameter for update action
- `self_close` parameter for close action (with `--self-close-exception`)
- Auto-retry on `reject` — creates a new review session and retries when same-session rejection fails

### Changed

- `log` action uses focused issue when no `id` provided
- `message` parameter now also serves as reason text (for reject/close/block/approve)
- `description` parameter description updated to reflect use in create and update
- `reason` is now optional for reject (was required)

### Fixed

- Web UI issue detail now checks HTTP response status before parsing JSON
- Web UI shows "Issue not found" message instead of a blank detail pane when an issue no longer exists

## [0.2.0] - 2026-02-17 (7839f93)

### Added

- First published release (v0.1.x was internal/unpublished).
