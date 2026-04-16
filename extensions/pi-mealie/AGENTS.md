---
name: pi-mealie
description: Mealie recipe manager API integration for pi
---

## Overview

Pi extension providing Mealie API access via four tools:

- **`mealie_recipes`** — Browse, search, get, create, update, delete, and scrape recipes from URLs
- **`mealie_mealplans`** — View today/week/date meals, add and remove meal plan entries. When adding a recipe to today or a past date, automatically updates the recipe's `lastMade` timestamp.
- **`mealie_shopping`** — View shopping lists, add/check/uncheck/delete items
- **`mealie_organizer`** — List, create, update, and delete tags, categories, tools, foods, and units. Supports search for foods and units.

## Configuration

Settings in `.pi/settings.json` under `"pi-mealie"`:

```json
{
  "pi-mealie": {
    "baseUrl": "https://mealie.e9n.dev/api",
    "apiToken": "<long-lived JWT or API token>"
  }
}
```

Both `baseUrl` and `apiToken` are required. Get an API token from Mealie → Settings → API Tokens.

## Architecture

- `src/index.ts` — Extension entry point; initializes client on session_start
- `src/settings.ts` — Reads baseUrl/apiToken from global/project settings
- `src/client.ts` — HTTP client wrapper; handles auth, pagination, error reporting
- `src/tools/recipes.ts` — Recipe CRUD + URL scraping. Supports ingredients, instructions, notes, tags, categories, servings (`recipeServings`). Auto-creates missing foods/units.
- `src/tools/mealplans.ts` — Meal plan viewing and management
- `src/tools/shopping.ts` — Shopping list management
- `src/tools/organizer.ts` — Full CRUD for tags, categories, tools, foods, units + search

## API Conventions

- All endpoints are prefixed with the configured `baseUrl` (e.g. `https://mealie.e9n.dev/api`)
- Auth via `Authorization: Bearer <token>` header
- Paginated endpoints use `page`/`per_page`/`total_pages` pattern; client auto-fetches all pages
- Recipe slugs are the primary identifier (not IDs)