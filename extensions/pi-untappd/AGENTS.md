---
name: pi-untappd
description: Untappd monitoring extension for pi — track venues, beers, and check-ins
---

# pi-untappd Extension

Monitors Untappd venues, users, and breweries. Tracks beers on tap, polls RSS feeds for check-ins, and maintains a normalized beer database.

## Architecture

- **Zero scraping by default** — all HTML scraping is manual/on-demand
- **RSS-first** — automated polling via pi-cron
- **Normalized beers** — single `beers` table, venue-specific prices in `menu_items`
- **Confidence scoring** — tracks which menu items are likely still available
- **Modular** — clean separation: schema, scraper, RSS, DB ops, web UI/API

## Key Modules

- `src/index.ts` — Extension entry point
- `src/schema.ts` — Kysely database schema and migrations
- `src/scraper/` — HTML scraping (manual only)
- `src/rss/` — RSS client and polling logic
- `src/db/operations.ts` — Database CRUD operations
- `src/web/` — Web UI and JSON API
- `src/cron.ts` — Cron job registration
- `src/maintenance/` — Confidence decay and cleanup

## Database Schema

9 tables:
- **venues** — Untappd venues
- **breweries** — Beer breweries
- **beers** — Normalized beer database (shared across venues)
- **venue_menus** — Menus within venues (On Tap, Bottles, etc.)
- **menu_items** — Per-venue beer entries with prices
- **users** — Untappd users
- **rss_sources** — RSS feed subscriptions
- **activity_events** — Parsed check-ins
- **preference_rules** — Optional filtering (future)

## Integration Points

- **pi-kysely** — Database schema, migrations, queries
- **pi-webserver** — Web UI at `/untappd`, JSON API at `/api/untappd/`
- **pi-cron** — RSS polling (every 15min) and confidence decay (daily)

## Conventions

- All API routes under `/api/untappd/`
- HTML scraping is **manual only** (triggered via UI/API, never cron)
- RSS polling is **automated** via cron (conservative intervals)
- Beers are normalized; prices are venue-specific
- Menu item confidence decays over time (1.0 → 0.0)

## Development

```bash
cd /Users/espen/Dev/pi/extensions/pi-untappd
npm install
npm run typecheck
```

Test locally by:
1. Symlinking to workspace: `ln -s $(pwd) ~/Dev/aivena/workspace/.pi/extensions/pi-untappd`
2. Start pi in workspace
3. Load webserver: `/web`
4. Navigate to `http://localhost:4100/untappd`

## Deployment

Published to npm as `@e9n/pi-untappd`. Auto-discovered by pi when installed.

## Future Enhancements

- Full HTML scraping implementation (currently placeholder)
- Preference rules matching
- Webhook notifications for new beers
- Advanced menu diff detection
- Multi-user RSS filtering
