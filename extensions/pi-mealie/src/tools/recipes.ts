/**
 * mealie_recipes tool — Browse, search, get, create, update, and delete recipes.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { isClientReady, mealie, apiList } from "../client.ts";

interface RecipeSummary {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	image: string | null;
	tags: { id: string; name: string; slug: string }[];
	recipeCategory: { id: string; name: string; slug: string }[];
	rating: number | null;
	prepTime: string | null;
	cookTime: string | null;
	totalTime: string | null;
	dateAdded: string;
	dateUpdated: string;
}

interface RecipeDetail {
	id: string;
	name: string;
	slug: string;
	description: string | null;
 recipeYield: string | null;
	prepTime: string | null;
	cookTime: string | null;
	totalTime: string | null;
	ingredients: { note: string; quantity: number | null; unit: { name: string } | null; food: { name: string } | null }[];
	instructions: { text: string; title: string | null }[];
	notes: { title: string | null; text: string }[];
	tags: { id: string; name: string; slug: string }[];
	recipeCategory: { id: string; name: string; slug: string }[];
	tools: { id: string; name: string; slug: string }[];
	nutrition: { calories: number | null; proteinContent: number | null; carbohydrateContent: number | null; fatContent: number | null } | null;
	rating: number | null;
	image: string | null;
	dateAdded: string;
	dateUpdated: string;
	extras: Record<string, string>;
}

const actionSchema = Type.Union([
	Type.Literal("list"),
	Type.Literal("search"),
	Type.Literal("get"),
	Type.Literal("create"),
	Type.Literal("update"),
	Type.Literal("delete"),
	Type.Literal("scrape_url"),
]);

export function registerRecipesTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "mealie_recipes",
		label: "Mealie Recipes",
		description: "Manage Mealie recipes — list, search, get details, create, update, delete, or scrape from a URL",
		parameters: Type.Object({
			action: actionSchema,
			slug: Type.Optional(Type.String({ description: "Recipe slug (for get/update/delete)" })),
			query: Type.Optional(Type.String({ description: "Search query (for search action)" })),
			name: Type.Optional(Type.String({ description: "Recipe name (for create/update)" })),
			description: Type.Optional(Type.String({ description: "Recipe description" })),
			url: Type.Optional(Type.String({ description: "URL to scrape recipe from (for scrape_url)" })),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Tag names" })),
			categories: Type.Optional(Type.Array(Type.String(), { description: "Category names" })),
			limit: Type.Optional(Type.Number({ description: "Max results (for list/search)" })),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
			if (!isClientReady()) {
				return {
					content: [{ type: "text" as const, text: "❌ Not configured. Set `pi-mealie.baseUrl` and `pi-mealie.apiToken` in settings.json" }],
					details: {},
				};
			}

			try {
				switch (params.action) {
					case "list": {
						const recipes = await apiList<RecipeSummary>("/recipes", {
							params: { perPage: params.limit ?? 50 },
							signal,
						});
						if (recipes.length === 0) {
							return { content: [{ type: "text", text: "No recipes found." }], details: {} };
						}
						const lines = recipes.map(formatSummary);
						return { content: [{ type: "text", text: `Found ${recipes.length} recipe(s):\n\n${lines.join("\n")}` }], details: {} };
					}

					case "search": {
						if (!params.query) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: query" }], details: {} };
						}
						const recipes = await apiList<RecipeSummary>("/recipes", {
							params: { search: params.query },
							signal,
						});
						const limited = params.limit ? recipes.slice(0, params.limit) : recipes;
						if (limited.length === 0) {
							return { content: [{ type: "text", text: `No recipes matching "${params.query}".` }], details: {} };
						}
						const lines = limited.map(formatSummary);
						return { content: [{ type: "text", text: `Found ${limited.length} recipe(s) for "${params.query}":\n\n${lines.join("\n")}` }], details: {} };
					}

					case "get": {
						if (!params.slug) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: slug" }], details: {} };
						}
						const recipe = await mealie.get<RecipeDetail>(`/recipes/${params.slug}`, undefined, signal);
						return { content: [{ type: "text", text: formatDetail(recipe) }], details: {} };
					}

					case "create": {
						const body: Record<string, unknown> = {};
						if (params.name) body.name = params.name;
						if (params.description) body.description = params.description;
						if (params.tags) body.tags = params.tags;
						if (params.categories) body.recipeCategory = params.categories;

						const recipe = await mealie.post<RecipeDetail>("/recipes", body, signal);
						return { content: [{ type: "text", text: `✅ Recipe created:\n\n${formatDetail(recipe)}` }], details: {} };
					}

					case "update": {
						if (!params.slug) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: slug" }], details: {} };
						}
						const body: Record<string, unknown> = {};
						if (params.name !== undefined) body.name = params.name;
						if (params.description !== undefined) body.description = params.description;
						if (params.tags) body.tags = params.tags;
						if (params.categories) body.recipeCategory = params.categories;

						const recipe = await mealie.patch<RecipeDetail>(`/recipes/${params.slug}`, body, signal);
						return { content: [{ type: "text", text: `✅ Recipe updated:\n\n${formatDetail(recipe)}` }], details: {} };
					}

					case "delete": {
						if (!params.slug) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: slug" }], details: {} };
						}
						await mealie.delete(`/recipes/${params.slug}`, signal);
						return { content: [{ type: "text", text: `✅ Recipe "${params.slug}" deleted.` }], details: {} };
					}

					case "scrape_url": {
						if (!params.url) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: url" }], details: {} };
						}
						const result = await mealie.post<RecipeDetail>("/recipes/create/url", { url: params.url }, signal);
						return { content: [{ type: "text", text: `✅ Recipe scraped from URL:\n\n${formatDetail(result)}` }], details: {} };
					}

					default:
						return { content: [{ type: "text", text: `❌ Unknown action: ${params.action}` }], details: {} };
				}
			} catch (error: any) {
				return { content: [{ type: "text", text: `❌ Error: ${error.message || String(error)}` }], details: {} };
			}
		},
	});
}

function formatSummary(r: RecipeSummary): string {
	const tags = r.tags?.map((t) => t.name).join(", ") || "";
	const cats = r.recipeCategory?.map((c) => c.name).join(", ") || "";
	const rating = r.rating ? ` ⭐${r.rating}` : "";
	const time = r.totalTime || r.prepTime || "";
	const parts = [`**${r.name}**${rating}`];
	if (time) parts.push(`⏱ ${time}`);
	if (cats) parts.push(`📁 ${cats}`);
	if (tags) parts.push(`🏷 ${tags}`);
	parts.push(`_${r.slug}_`);
	return parts.join(" | ");
}

function formatDetail(r: RecipeDetail): string {
	const lines: string[] = [];
	lines.push(`# ${r.name}`);
	lines.push(`**Slug:** ${r.slug}`);
	if (r.description) lines.push(`\n${r.description}`);
	if (r.recipeYield) lines.push(`**Yield:** ${r.recipeYield}`);
	if (r.prepTime) lines.push(`**Prep Time:** ${r.prepTime}`);
	if (r.cookTime) lines.push(`**Cook Time:** ${r.cookTime}`);
	if (r.totalTime) lines.push(`**Total Time:** ${r.totalTime}`);
	if (r.rating) lines.push(`**Rating:** ${"⭐".repeat(Math.round(r.rating))} (${r.rating}/5)}`);

	const cats = r.recipeCategory?.map((c) => c.name).join(", ");
	const tags = r.tags?.map((t) => t.name).join(", ");
	const tools = r.tools?.map((t) => t.name).join(", ");
	if (cats) lines.push(`\n📁 **Categories:** ${cats}`);
	if (tags) lines.push(`🏷 **Tags:** ${tags}`);
	if (tools) lines.push(`🔧 **Tools:** ${tools}`);

	if (r.nutrition) {
		const n = r.nutrition;
		lines.push(`\n### Nutrition`);
		const nutrition = [
			n.calories ? `Calories: ${n.calories}` : "",
			n.proteinContent ? `Protein: ${n.proteinContent}g` : "",
			n.carbohydrateContent ? `Carbs: ${n.carbohydrateContent}g` : "",
			n.fatContent ? `Fat: ${n.fatContent}g` : "",
		].filter(Boolean).join(" | ");
		if (nutrition) lines.push(nutrition);
	}

	if (r.ingredients?.length) {
		lines.push(`\n### Ingredients`);
		for (const ing of r.ingredients) {
			const qty = ing.quantity ?? "";
			const unit = ing.unit?.name ? ` ${ing.unit.name}` : "";
			const food = ing.food?.name ? ` ${ing.food.name}` : "";
			lines.push(`- ${qty}${unit}${food} — ${ing.note}`);
		}
	}

	if (r.instructions?.length) {
		lines.push(`\n### Instructions`);
		for (let i = 0; i < r.instructions.length; i++) {
			const step = r.instructions[i];
			const title = step.title ? ` (${step.title})` : "";
			lines.push(`${i + 1}. ${step.text}${title}`);
		}
	}

	if (r.notes?.length) {
		lines.push(`\n### Notes`);
		for (const note of r.notes) {
			const title = note.title ? `**${note.title}:** ` : "";
			lines.push(`- ${title}${note.text}`);
		}
	}

	return lines.join("\n");
}