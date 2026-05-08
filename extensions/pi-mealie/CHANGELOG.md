# Changelog

## [0.3.0] - 2026-05-08

### Changed

- Migrated from `@mariozechner/*` to `@earendil-works/*` package scope

## 0.2.0 — 2026-04-15

- `mealie_mealplans`: auto-update recipe `lastMade` when adding a recipe to today or a past date
- `mealie_recipes`: add `servings` numeric parameter for `recipeServings` (recipe scaling); fixes recipes created with 0 portions
- `mealie_recipes`: add ingredients, instructions, notes, tags, and categories to create/update (PR #124)
- `mealie_recipes`: auto-resolve tags, categories, and foods by name; auto-create missing foods/units during recipe PATCH (PR #125, #127)
- `mealie_organizer`: full CRUD — add update and delete for tags, categories, tools, foods, and units (PR #123)
- `mealie_organizer`: search for foods and units (PR #125)
- `mealie_mealplans`: expose entry IDs in output for remove action; fix recipe linking (PR #123)
- Bug fixes: remove invalid slug from food/unit objects (PR #126), add ingredientReferences to instructions (PR #128)

## 0.1.0 — 2026-04-11

- Initial release
- `mealie_recipes` tool: list, search, get, create, update, delete, scrape from URL
- `mealie_mealplans` tool: today, week, date, add, remove
- `mealie_shopping` tool: lists, items, add_item, check/uncheck, delete
- `mealie_organizer` tool: list/create tags, categories, tools, foods, units
