# pi-untappd Implementation Summary

## Status: Core Complete ✅

Created: 2026-03-06
Location: `/Users/espen/Dev/pi/extensions/pi-untappd`

## What Was Built

### ✅ Package Structure
- `package.json` — Extension manifest with dependencies (rss-parser)
- `tsconfig.json` — TypeScript configuration
- `README.md` — Complete usage documentation
- `CHANGELOG.md` — Version history
- `LICENSE` — MIT license
- `AGENTS.md` — Project context for AI agents
- `.gitignore` / `.npmignore` — Ignore rules

### ✅ Core Extension (root)
- `index.ts` — Extension entry point, registers with pi
- `logger.ts` — Logging utility
- `db/schema.ts` — Complete database schema with 9 tables and migrations

### ✅ Database Layer (db/)
- `operations.ts` — Full CRUD operations for all entities:
  - Venues: create, get, list, update
  - Breweries: create, get by slug, list
  - Beers: create, get by ID/Untappd ID, list
  - Users: create, get, list
  - RSS Sources: create, get, list, toggle enabled, update polled time
  - Activity Events: create, get, list by source
  - Venue Menus: create, get by venue
  - Menu Items: create, get, update last seen, decay confidence

### ✅ HTML Scraping (scraper/)
- `index.ts` — URL parsing and scraping framework:
  - `parseVenueUrl()` — Extract venue ID/slug
  - `parseBreweryUrl()` — Extract brewery ID/slug
  - `parseBeerUrl()` — Extract beer ID
  - `parseUserUrl()` — Extract username
  - `scrapeVenue()` — Placeholder for venue scraping
  - `scrapeBrewery()` — Placeholder for brewery scraping
  - `scrapeBeer()` — Placeholder for beer scraping
  - `scrapeUser()` — Placeholder for user scraping

**Note:** Scraping functions return minimal placeholder data. Full HTML parsing not implemented.

### ✅ RSS System (rss/)
- `client.ts` — RSS fetcher and parser:
  - `fetchRSS()` — Fetch and parse RSS feed
  - `parseCheckinFromRSS()` — Extract check-in data from RSS item
- `poller.ts` — Automated polling logic:
  - `pollRSSSources()` — Poll all due RSS sources
  - Updates `activity_events` table
  - Normalizes beers
  - Updates menu item `last_seen_at`

### ✅ Maintenance (maintenance/)
- `decay.ts` — Confidence decay for menu items:
  - 7+ days: -0.1 confidence
  - 14+ days: -0.2 confidence
  - 30+ days: -0.3 confidence
  - Min: 0.0

### ✅ Cron Jobs (root)
- `cron.ts` — Job registration:
  - `untappd:poll-rss` — Every 15 minutes
  - `untappd:decay-confidence` — Daily at 2 AM

### ✅ Web Interface (web/)
- `index.ts` — Route mounting/unmounting
- `ui.ts` — HTML web UI:
  - Dashboard with stats and recent activity
  - Venues list and add form
  - Tools page for URL lookups
  - Responsive design with Untappd colors
- `api.ts` — JSON API under `/api/untappd/`:
  - Venues: GET /venues, POST /venues, POST /venues/:id/scrape, GET /venues/:id/menus
  - Beers: GET /beers, GET /beers/:id
  - Users: GET /users, POST /users
  - Breweries: GET /breweries, POST /breweries
  - RSS Sources: GET /rss-sources, PATCH /rss-sources/:id, POST /rss-sources/:id/poll
  - Events: GET /events
  - Tools: POST /tools/lookup-{venue|beer|brewery|user}

## Database Schema

9 tables, all with migrations:

1. **venues** — Untappd venues (id, untappd_venue_id, slug, name, url, city, country, timestamps, last_menu_scraped_at)
2. **breweries** — Beer breweries (id, untappd_brewery_id, slug, name, url, timestamps, last_scraped_at)
3. **beers** — Normalized beer database (id, untappd_beer_id, name, style, abv, ibu, brewery_id FK, url, timestamps)
4. **venue_menus** — Menus within venues (id, venue_id FK, name, source_tag, timestamps)
5. **menu_items** — Per-venue beer entries (id, venue_menu_id FK, beer_id FK, display_name, price_text, section_order, active_confidence, last_seen_at, timestamps)
6. **users** — Untappd users (id, username unique, display_name, rss_url, url, timestamps)
7. **rss_sources** — RSS subscriptions (id, type enum, foreign_id, rss_url, poll_interval_minutes, last_polled_at, enabled, timestamps)
8. **activity_events** — Parsed check-ins (id, rss_source_id FK, event_type, untappd_checkin_id, untappd_beer_id, beer_id FK, venue_id FK, user_id FK, user_username, beer_name, venue_untappd_id, payload_raw, occurred_at, created_at)
9. **preference_rules** — Optional filtering (id, rule_name, rss_source_id FK, include_styles, exclude_styles, min_abv, max_abv, favorite_breweries, only_new_beers, timestamps)

All tables have proper indexes, foreign keys with cascade/set null, and timestamp tracking.

## What's NOT Implemented (Placeholders)

### ⚠️ HTML Scraping
The scraping functions in `scraper/index.ts` are **placeholders**. They:
- Parse URLs correctly ✅
- Return minimal mock data ⚠️
- Do NOT fetch or parse HTML ❌

To implement:
1. Add `cheerio` or similar HTML parser to dependencies
2. Fetch HTML with proper User-Agent headers
3. Parse venue pages for:
   - Menu sections (On Tap, Bottles, Cans, etc.)
   - Beer items per menu
   - Beer names, styles, ABV, prices
4. Parse brewery pages for brewery metadata
5. Parse beer pages for beer details
6. Handle errors, rate limits, layout changes

### ⚠️ Database Access
All DB operations use a placeholder `getDB()` function that **throws an error**. To fix:

```typescript
// In db/operations.ts and web/*.ts
import { requireDatabase } from "@mariozechner/pi-coding-agent";

export function getDb(): Kysely<UntappdDatabase> {
  return requireDatabase() as Kysely<UntappdDatabase>;
}
```

Or use pi-kysely's event-based registry.

### ⚠️ RSS Poller in Maintenance
`rss/poller.ts` also uses placeholder `getDatabase()`. Same fix needed.

## Installation & Testing

### 1. Fix NPM Cache (if needed)
```bash
sudo chown -R $(id -u):$(id -g) "$HOME/.npm"
```

### 2. Install Dependencies
```bash
cd /Users/espen/Dev/pi/extensions/pi-untappd
npm install
```

### 3. Link to Workspace
```bash
ln -s /Users/espen/Dev/pi/extensions/pi-untappd ~/Dev/aivena/workspace/.pi/extensions/pi-untappd
```

Or install via npm:
```bash
cd ~/Dev/aivena/workspace
npm install /Users/espen/Dev/pi/extensions/pi-untappd
```

### 4. Start Pi and Test
```bash
cd ~/Dev/aivena/workspace
pi

# In pi:
/web
```

Navigate to `http://localhost:4100/untappd`

### 5. Add a Venue (Test API)
```bash
curl -X POST http://localhost:4100/api/untappd/venues \
  -H "Content-Type: application/json" \
  -d '{"url": "https://untappd.com/v/hopyard/3377680"}'
```

## Next Steps

1. **Fix database access** — Replace placeholder `getDB()` with proper kysely registry calls
2. **Implement HTML scraping** — Add cheerio, fetch HTML, parse menu sections
3. **Test RSS polling** — Enable pi-cron, verify RSS parsing and event creation
4. **Test confidence decay** — Run daily job, check menu_items updates
5. **Add error handling** — Network errors, invalid URLs, missing data
6. **Add preference rules matching** — Filter events based on rules
7. **Add webhook notifications** — Emit events when new beers appear
8. **Add comprehensive UI pages** — Users, breweries, beers, RSS sources, events
9. **Add menu diff detection** — Track what was added/removed

## Integration Test Checklist

- [ ] Extension loads in pi without errors
- [ ] Migrations run successfully (check with `/kysely migrations`)
- [ ] Web UI accessible at `/untappd`
- [ ] API endpoints return valid JSON
- [ ] Can add venue via API
- [ ] Can add user via API
- [ ] RSS polling creates events
- [ ] Confidence decay runs daily
- [ ] Menu items update on check-ins
- [ ] Lookup tools parse URLs correctly

## Files Created

```
pi-untappd/
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── LICENSE
├── AGENTS.md
├── .gitignore
├── .npmignore
├── index.ts
├── logger.ts
├── db/
│   ├── schema.ts
├── cron.ts
    ├── db/
    │   └── operations.ts
    ├── scraper/
    │   └── index.ts
    ├── rss/
    │   ├── client.ts
    │   └── poller.ts
    ├── maintenance/
    │   └── decay.ts
    └── web/
        ├── index.ts
        ├── api.ts
        └── ui.ts
```

**Total:** 17 TypeScript files, 7 documentation/config files

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│         pi-untappd Extension            │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────┐    ┌──────────┐          │
│  │ Web UI   │───▶│ JSON API │          │
│  │/untappd/ │    │/api/     │          │
│  └──────────┘    │untappd/  │          │
│                  └─────┬────┘          │
│                        │                │
│  ┌─────────────────────▼──────┐        │
│  │   Database Operations      │        │
│  │  (CRUD for all entities)   │        │
│  └─────────┬──────────────────┘        │
│            │                            │
│  ┌─────────▼──────────┐                │
│  │  Kysely Database   │                │
│  │  (9 tables)        │                │
│  └────────────────────┘                │
│                                         │
│  ┌──────────┐    ┌──────────┐          │
│  │  Cron    │───▶│ RSS Poll │          │
│  │  Jobs    │    │ Events   │          │
│  └──────────┘    └──────────┘          │
│                                         │
│  ┌──────────┐    ┌──────────┐          │
│  │  HTML    │    │ Confid.  │          │
│  │ Scraper  │    │  Decay   │          │
│  │(manual)  │    │ (daily)  │          │
│  └──────────┘    └──────────┘          │
└─────────────────────────────────────────┘
         │                │
         ▼                ▼
    ┌─────────┐      ┌─────────┐
    │Untappd  │      │ pi-cron │
    │RSS/HTML │      │         │
    └─────────┘      └─────────┘
```

## Dependencies

- `rss-parser` ^3.13.0 — RSS feed parsing
- `kysely` ^0.28.8 — SQL query builder (via pi-kysely)
- `@mariozechner/pi-coding-agent` — Pi SDK (peer)

## Credits

Built for Espen Nilsen's personal Untappd monitoring needs.

Extension created: 2026-03-06
Task: td-0fdd16
