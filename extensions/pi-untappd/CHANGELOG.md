# Changelog

## [0.2.0] - 2026-05-08

### Changed
- Migrated from @mariozechner/* to @earendil-works/* package scope

All notable changes to pi-untappd will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-06

### Added
- Initial release
- Venue, user, and brewery monitoring
- RSS feed polling for check-ins
- Normalized beer database with venue-specific prices
- Web dashboard under `/untappd`
- JSON API under `/api/untappd/`
- Manual HTML scraping for venues, breweries, beers, and users
- Automated RSS polling via pi-cron
- Confidence decay for menu items
- Database schema with migrations
- Lookup tools for parsing Untappd URLs
- Integration with pi-kysely, pi-webserver, and pi-cron

[0.1.0]: https://github.com/espennilsen/pi/releases/tag/pi-untappd-v0.1.0
