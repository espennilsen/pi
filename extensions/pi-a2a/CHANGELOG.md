# Changelog

## [0.4.0] - 2026-05-08

### Added
- `bindInterface` config option to bind to and advertise a specific network interface
- Auto-detect publicUrl IP when `bind: "0.0.0.0"` instead of defaulting to localhost
- `buildServerConfig()` helper that returns both bind address and publicUrl

### Changed
- `bindInterface` now binds to the specified interface's IP (not just advertising it)
- Migrated from @mariozechner/* to @earendil-works/* package scope

### Fixed
- Documentation clarified that `bindInterface` binds to the interface, not just advertises it

