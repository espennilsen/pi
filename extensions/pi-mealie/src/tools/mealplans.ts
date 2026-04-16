/**
 * mealie_mealplans tool -- Meal planning: view today/week, add meals, remove meals.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { isClientReady, mealie, apiList } from "../client.ts";

/** Format a Date as YYYY-MM-DD in local timezone (avoids UTC shift from toISOString). */
function toLocalISODate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Validate a path segment contains only safe characters. */
function validatePathSegment(value: string, name: string): void {
	if (!/^[\w-]+$/.test(value)) {
		throw new Error(`Invalid ${name}: "${value}". Only alphanumeric, hyphens, and underscores allowed.`);
	}
}

/** Recipe data returned by the Mealie API. */
interface RecipeSummary {
	id: string;
	name: string;
	slug: string;
	lastMade: string | null;
}

/** Resolve a recipe slug by fetching the recipe detail. Returns the full recipe object. */
async function resolveRecipe(slug: string, signal?: AbortSignal): Promise<RecipeSummary> {
	validatePathSegment(slug, "recipeSlug");
	const recipe = await mealie.get<RecipeSummary>(`/recipes/${slug}`, undefined, signal);
	if (!recipe?.id) {
		throw new Error(`Recipe not found for slug "${slug}"`);
	}
	return recipe;
}

interface MealPlanEntry {
	id: string;
	date: string;
	entryType: "breakfast" | "lunch" | "dinner" | "side" | "snack";
	recipe: { id: string; name: string; slug: string } | null;
	title: string | null;
	text: string | null;
	note: string | null;
}

const actionSchema = Type.Union([
	Type.Literal("today"),
	Type.Literal("week"),
	Type.Literal("date"),
	Type.Literal("add"),
	Type.Literal("remove"),
]);

const entryTypeSchema = Type.Union([
	Type.Literal("breakfast"),
	Type.Literal("lunch"),
	Type.Literal("dinner"),
	Type.Literal("side"),
	Type.Literal("snack"),
]);

const ENTRY_TYPE_LABELS: Record<string, string> = {
	breakfast: "[Breakfast]",
	lunch: "[Lunch]",
	dinner: "[Dinner]",
	side: "[Side]",
	snack: "[Snack]",
};

export function registerMealplansTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "mealie_mealplans",
		label: "Mealie Meal Plans",
		description: "Manage Mealie meal plans -- view today, this week, or a specific date; add or remove meal entries",
		parameters: Type.Object({
			action: actionSchema,
			date: Type.Optional(Type.String({ description: "ISO date YYYY-MM-DD for date/add/remove actions" })),
			entryType: Type.Optional(entryTypeSchema),
			recipeSlug: Type.Optional(Type.String({ description: "Recipe slug to add to meal plan" })),
			title: Type.Optional(Type.String({ description: "Title for a note entry (when not linking a recipe)" })),
			note: Type.Optional(Type.String({ description: "Note text" })),
			entryId: Type.Optional(Type.String({ description: "Meal plan entry ID (for remove)" })),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
			if (!isClientReady()) {
				return {
					content: [{ type: "text", text: "Not configured. Set pi-mealie.baseUrl and pi-mealie.apiToken in settings.json" }],
					details: {},
				};
			}

			try {
				switch (params.action) {
					case "today": {
						const entries = await mealie.get<MealPlanEntry[]>("/households/mealplans/today", undefined, signal);
						if (!entries || entries.length === 0) {
							return { content: [{ type: "text", text: "No meals planned for today." }], details: {} };
						}
						const lines = entries.map(formatEntry);
						return { content: [{ type: "text", text: "**Today's Meals**\n\n" + lines.join("\n") }], details: {} };
					}

					case "week": {
						const today = new Date();
						const dayOfWeek = today.getDay();
						const monday = new Date(today);
						monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
						const sunday = new Date(monday);
						sunday.setDate(monday.getDate() + 6);

						const start = toLocalISODate(monday);
						const end = toLocalISODate(sunday);

						const entries = await apiList<MealPlanEntry>("/households/mealplans", {
							params: { start_date: start, end_date: end },
							signal,
						});
						if (!entries || entries.length === 0) {
							return { content: [{ type: "text", text: "No meals planned for this week (" + start + " to " + end + ")." }], details: {} };
						}

						// Group by date
						const byDate: Record<string, MealPlanEntry[]> = {};
						for (const e of entries) {
							(byDate[e.date] ??= []).push(e);
						}
						const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
						const lines: string[] = [];
						for (let d = new Date(monday); d <= sunday; d.setDate(d.getDate() + 1)) {
							const iso = toLocalISODate(d);
							const dayName = dayNames[d.getDay()];
							const dayEntries = byDate[iso];
							if (dayEntries && dayEntries.length > 0) {
								lines.push("**" + dayName + " " + iso + "**");
								lines.push(dayEntries.map(formatEntry).join("\n"));
								lines.push("");
							} else {
								lines.push("**" + dayName + " " + iso + "** -- no meals");
								lines.push("");
							}
						}
						return { content: [{ type: "text", text: "**This Week's Meals** (" + start + " - " + end + ")\n\n" + lines.join("\n") }], details: {} };
					}

					case "date": {
						if (!params.date) {
							return { content: [{ type: "text", text: "Missing required parameter: date" }], details: {} };
						}
						const entries = await apiList<MealPlanEntry>("/households/mealplans", {
							params: { start_date: params.date, end_date: params.date },
							signal,
						});
						if (!entries || entries.length === 0) {
							return { content: [{ type: "text", text: "No meals planned for " + params.date + "." }], details: {} };
						}
						const lines = entries.map(formatEntry);
						return { content: [{ type: "text", text: "**Meals for " + params.date + "**\n\n" + lines.join("\n") }], details: {} };
					}

					case "add": {
						if (!params.date) {
							return { content: [{ type: "text", text: "Missing required parameter: date" }], details: {} };
						}
						const body: Record<string, unknown> = {
							date: params.date,
							entryType: params.entryType || "dinner",
						};
						let recipe: RecipeSummary | undefined;
						if (params.recipeSlug) {
							// Resolve slug → recipe detail (Mealie API requires recipe_id, not slug)
							recipe = await resolveRecipe(params.recipeSlug, signal);
							body.recipeId = recipe.id;
						} else if (params.title) {
							body.title = params.title;
						} else {
							return { content: [{ type: "text", text: "Must provide either recipeSlug or title" }], details: {} };
						}
						if (params.note) body.note = params.note;

						const entry = await mealie.post<MealPlanEntry>("/households/mealplans", body, signal);

						// Update recipe's lastMade when meal plan date is today or past,
						// and is more recent than the current lastMade (reuses recipe from resolveRecipe above)
						if (recipe) {
							const today = toLocalISODate(new Date());
							if (params.date <= today) {
								const currentLastMade = recipe.lastMade ? recipe.lastMade.slice(0, 10) : null;
								if (!currentLastMade || params.date > currentLastMade) {
									try {
										await mealie.patch(`/recipes/${recipe.slug}/last-made`, { timestamp: params.date + "T12:00:00" }, signal);
									} catch (err) {
										// Best-effort — don't fail the meal plan add if last-made update fails
										console.warn('Failed to update lastMade for', recipe.slug, err);
									}
								}
							}
						}

						return { content: [{ type: "text", text: "Meal added to " + params.date + ":\n\n" + formatEntry(entry) }], details: {} };
					}

					case "remove": {
						if (!params.entryId) {
							return { content: [{ type: "text", text: "Missing required parameter: entryId" }], details: {} };
						}
						validatePathSegment(params.entryId, "entryId");
						await mealie.delete("/households/mealplans/" + params.entryId, signal);
						return { content: [{ type: "text", text: "Meal plan entry " + params.entryId + " removed." }], details: {} };
					}

					default:
						return { content: [{ type: "text", text: "Unknown action: " + params.action }], details: {} };
				}
			} catch (error: any) {
				return { content: [{ type: "text", text: "Error: " + (error.message || String(error)) }], details: {} };
			}
		},
	});
}

function formatEntry(e: MealPlanEntry): string {
	const label = ENTRY_TYPE_LABELS[e.entryType] || "[" + e.entryType + "]";
	const idSuffix = " (id: `" + e.id + "`)";
	if (e.recipe) {
		return label + " " + e.recipe.name + " (_" + e.recipe.slug + "_)" + (e.note ? " -- " + e.note : "") + idSuffix;
	}
	return label + " " + (e.title || "Untitled") + (e.note ? " -- " + e.note : "") + idSuffix;
}
