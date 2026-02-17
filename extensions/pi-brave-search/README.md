# @e9n/pi-brave-search

Web search extension for [pi](https://github.com/mariozechner/pi-coding-agent) — search the web via the [Brave Search API](https://brave.com/search/api/).

## Features

- **Web search** — query the Brave Search API and get ranked results with titles, URLs, and descriptions
- **Configurable results** — set default count (1–20) and override per call
- **Freshness filter** — limit results by time range (day, week, month, year, or custom date range)
- **Regional control** — filter by country and language
- **Safe search** — configurable filtering level (off / moderate / strict)

## Setup

1. Get a Brave Search API key from [brave.com/search/api](https://brave.com/search/api/)
2. Add to your pi settings (`~/.pi/agent/settings.json`):

```json
{
  "pi-brave-search": {
    "apiKey": "BSA..."
  }
}
```

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `apiKey` | string | — | Brave Search API subscription token (required) |
| `defaultCount` | number | `5` | Default number of results to return (1–20) |
| `safesearch` | `"off"` \| `"moderate"` \| `"strict"` | `"moderate"` | Safe search filtering level |

## Tool: `search`

Search the web using Brave Search.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✅ | Search query |
| `count` | number | — | Number of results (1–20, overrides `defaultCount`) |
| `freshness` | string | — | Time filter: `pd` (day), `pw` (week), `pm` (month), `py` (year), or `YYYY-MM-DDtoYYYY-MM-DD` |
| `country` | string | — | 2-letter country code (e.g. `US`, `NO`, `GB`) |
| `search_lang` | string | — | Language code (e.g. `en`, `no`) |

## Install

```bash
pi install npm:@e9n/pi-brave-search
```

## License

MIT
