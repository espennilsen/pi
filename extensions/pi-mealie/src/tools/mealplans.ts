/**
 * mealie_mealplans tool -- Meal planning: view today/week, add meals, remove meals.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { isClientReady, mealie } from "../client.ts";

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

						const start = monday.toISOString().slice(0, 10);
						const end = sunday.toISOString().slice(0, 10);

						const entries = await mealie.get<MealPlanEntry[]>(
							"/households/mealplans",
							{ start_date: start, end_date: end },
							signal,
						);
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
							const iso = d.toISOString().slice(0, 10);
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
						const entries = await mealie.get<MealPlanEntry[]>(
							"/households/mealplans",
							{ start_date: params.date, end_date: params.date },
							signal,
						);
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
						if (params.recipeSlug) {
							body.recipeSlug = params.recipeSlug;
						} else if (params.title) {
							body.title = params.title;
							body.recipeSlug = null;
						} else {
							return { content: [{ type: "text", text: "Must provide either recipeSlug or title" }], details: {} };
						}
						if (params.note) body.note = params.note;

						const entry = await mealie.post<MealPlanEntry>("/households/mealplans", body, signal);
						return { content: [{ type: "text", text: "Meal added to " + params.date + ":\n\n" + formatEntry(entry) }], details: {} };
					}

					case "remove": {
						if (!params.entryId) {
							return { content: [{ type: "text", text: "Missing required parameter: entryId" }], details: {} };
						}
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
	if (e.recipe) {
		return label + " " + e.recipe.name + " (_" + e.recipe.slug + "_)" + (e.note ? " -- " + e.note : "");
	}
	return label + " " + (e.title || "Untitled") + (e.note ? " -- " + e.note : "");
}