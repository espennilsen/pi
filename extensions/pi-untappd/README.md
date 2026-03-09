# pi-untappd

**Untappd venue, user, and brewery monitoring extension for pi.**

Monitor Untappd venues, track beers on tap, follow user check-ins, and maintain a normalized beer database with venue-specific prices. Integrates seamlessly with pi-kysely, pi-webserver, and pi-cron.

## Features

- **Venue Monitoring**: Track multiple venues and their menu updates
- **RSS Polling**: Automated check-in monitoring via Untappd RSS feeds
- **Beer Normalization**: Single source of truth for beers, with venue-specific prices
- **Confidence Scoring**: Track which beers are likely still available
- **Web Dashboard**: Manage sources, view menus, and explore activity
- **JSON API**: Programmatic access under `/api/untappd/`
- **Manual Scraping**: On-demand HTML scraping for initial data seeding
- **Lookup Tools**: Parse and validate Untappd URLs

## Installation

```bash
cd /Users/espen/Dev/pi/extensions/pi-untappd
npm install
```

The extension auto-registers with pi when loaded.

## Requirements

- **pi-kysely**: Database management
- **pi-webserver**: Web UI and HTTP API
- **pi-cron** (optional): Automated RSS polling

## Usage

### Start Web Server

```bash
/web
```

Navigate to `http://localhost:4100/untappd` for the dashboard.

### Add a Venue

Via UI:
1. Go to `/untappd/venues/add`
2. Paste Untappd venue URL (e.g., `https://untappd.com/v/hopyard/3377680`)
3. Submit

Via API:
```bash
curl -X POST http://localhost:4100/api/untappd/venues \
  -H "Content-Type: application/json" \
  -d '{"url": "https://untappd.com/v/hopyard/3377680"}'
```

This creates:
- Venue record
- RSS source (auto-enabled, polls every 15 minutes)

### Add a User

Via UI:
1. Go to `/untappd/users/add`
2. Enter username and paste RSS URL from your Untappd settings
3. Submit

Via API:
```bash
curl -X POST http://localhost:4100/api/untappd/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "espennilsen",
    "rssUrl": "https://untappd.com/rss/...",
    "displayName": "Espen Nilsen"
  }'
```

### Manual Scraping

Scrape a venue's menu:
```bash
curl -X POST http://localhost:4100/api/untappd/venues/1/scrape
```

Or use the "Scrape now" button in the UI.

### RSS Polling

With pi-cron enabled, RSS feeds are polled automatically based on `poll_interval_minutes` (default: 15).

Manual poll:
```bash
curl -X POST http://localhost:4100/api/untappd/rss-sources/1/poll
```

## Database Schema

- **venues**: Untappd venues
- **breweries**: Beer breweries
- **beers**: Normalized beer database (single source)
- **venue_menus**: Menus within venues (On Tap, Bottles, etc.)
- **menu_items**: Per-venue beer entries with prices
- **users**: Untappd users
- **rss_sources**: RSS feed subscriptions
- **activity_events**: Parsed check-ins and activity
- **preference_rules**: Optional filtering rules (future)

## API Endpoints

All endpoints under `/api/untappd/`:

### Venues
- `GET /venues` - List all venues
- `POST /venues` - Add venue by URL
- `POST /venues/:id/scrape` - Scrape venue menus
- `GET /venues/:id/menus` - Get venue menus with items

### Beers
- `GET /beers` - List beers
- `GET /beers/:id` - Get beer details

### Users
- `GET /users` - List users
- `POST /users` - Add user

### Breweries
- `GET /breweries` - List breweries
- `POST /breweries` - Add brewery by URL

### RSS Sources
- `GET /rss-sources` - List all sources
- `PATCH /rss-sources/:id` - Update source (enable/disable)
- `POST /rss-sources/:id/poll` - Poll source immediately

### Events
- `GET /events` - List recent activity events

### Tools
- `POST /tools/lookup-venue` - Parse venue URL
- `POST /tools/lookup-beer` - Parse beer URL
- `POST /tools/lookup-brewery` - Parse brewery URL
- `POST /tools/lookup-user` - Parse user URL

## Configuration

No special configuration required. Integrates with existing pi settings.

## Cron Jobs

pi-untappd relies on [pi-cron](../pi-cron/) for scheduled tasks. Jobs must be added manually via the `cron` tool:

```
cron add --name "untappd:poll-rss" --schedule "*/15 * * * *" --prompt "Poll all enabled Untappd RSS sources for new check-ins. Use the untappd API endpoint: POST /api/untappd/rss-sources to list sources, then poll each."

cron add --name "untappd:decay-confidence" --schedule "0 2 * * *" --prompt "Run menu item confidence decay for Untappd. Items not seen in 7+ days get reduced confidence."
```

Start the scheduler with `/cron on` or `pi --cron`.

- **untappd:poll-rss**: Every 15 minutes — polls enabled RSS sources for new check-ins
- **untappd:decay-confidence**: Daily at 2 AM — decays menu item confidence based on last seen date

## Development

```bash
npm run typecheck
```

## License

MIT — see LICENSE file

## Author

Espen Nilsen <hi@e9n.dev>
