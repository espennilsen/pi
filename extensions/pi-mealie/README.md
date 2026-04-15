# @e9n/pi-mealie

Mealie recipe manager API integration for pi.

## Tools

| Tool | Description |
|------|-------------|
| `mealie_recipes` | Browse, search, get, create, update, delete, and scrape recipes |
| `mealie_mealplans` | View meals today/week/date, add and remove entries. Auto-updates recipe `lastMade` when adding a recipe to today/past dates |
| `mealie_shopping` | Shopping lists — view, add, check/uncheck/delete items |
| `mealie_organizer` | List and create tags, categories, tools, foods, units |

## Configuration

Add to `.pi/settings.json`:

```json
{
  "pi-mealie": {
    "baseUrl": "https://mealie.e9n.dev/api",
    "apiToken": "<your-mealie-api-token>"
  }
}
```

Get an API token from Mealie → Settings → API Tokens.