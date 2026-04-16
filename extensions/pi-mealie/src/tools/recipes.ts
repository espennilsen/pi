/**
 * mealie_recipes tool — Browse, search, get, create, update, and delete recipes.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { isClientReady, mealie, apiList } from "../client.ts";

/** Validate a path segment contains only safe characters. */
function validatePathSegment(value: string, name: string): void {
	if (!/^[\w-]+$/.test(value)) {
		throw new Error(`Invalid ${name}: "${value}". Only alphanumeric, hyphens, and underscores allowed.`);
	}
}

/** Check if a hostname (brackets already stripped) points to a private/internal address. */
function checkPrivateHost(host: string): boolean {
	// Simple hostnames: localhost
	if (host === "localhost") return true;

	// Direct IPv4 private ranges
	if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0)/.test(host)) return true;

	// IPv6 loopback
	if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;

	// IPv4-mapped IPv6: ::ffff:a.b.c.d or ::ffff:XXXX:XXXX (hex)
	const fffffMatch = host.match(/^::ffff:(.+)$/i);
	if (fffffMatch) {
		const rest = fffffMatch[1];
		// If it's in dotted-decimal form, test directly
		if (/^\d+\.\d+\.\d+\.\d+$/.test(rest)) {
			return checkPrivateHost(rest);
		}
		// Hex form: two 16-bit groups like 7f00:1 — convert to dotted decimal
		const hexMatch = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
		if (hexMatch) {
			const hi = parseInt(hexMatch[1], 16);
			const lo = parseInt(hexMatch[2], 16);
			const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
			return checkPrivateHost(ipv4);
		}
	}

	return false;
}

interface OrganizerItem {
	id: string;
	name: string;
	slug: string;
}

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
	recipeServings: number;
	prepTime: string | null;
	cookTime: string | null;
	totalTime: string | null;
	recipeIngredient: { note: string; quantity: number | null; unit: { name: string } | null; food: { name: string } | null }[];
	recipeInstructions: { text: string; title: string | null }[];
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

const ingredientSchema = Type.Object({
	note: Type.Optional(Type.String({ description: "Free-text ingredient description (e.g. 'finely chopped')" })),
	quantity: Type.Optional(Type.Number({ description: "Amount (e.g. 2, 0.5)" })),
	unit: Type.Optional(Type.String({ description: "Unit name (e.g. 'g', 'cups', 'stk')" })),
	food: Type.Optional(Type.String({ description: "Food name (e.g. 'kjøttdeig', 'onion')" })),
});

const instructionSchema = Type.Object({
	text: Type.String({ description: "Step text" }),
	title: Type.Optional(Type.String({ description: "Optional section title" })),
});

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
			recipeYield: Type.Optional(Type.String({ description: "Yield display text (e.g. '4 servings', '2-3 wraps')" })),
			servings: Type.Optional(Type.Number({ description: "Number of servings (numeric, e.g. 4). Used for recipe scaling. Defaults to 0 if not set.", minimum: 0 })),
			prepTime: Type.Optional(Type.String({ description: "Prep time (e.g. '15 Minutes')" })),
			cookTime: Type.Optional(Type.String({ description: "Cook time (e.g. '30 Minutes')" })),
			totalTime: Type.Optional(Type.String({ description: "Total time (e.g. '45 Minutes')" })),
			ingredients: Type.Optional(Type.Array(ingredientSchema, { description: "Recipe ingredients" })),
			instructions: Type.Optional(Type.Array(instructionSchema, { description: "Recipe steps/instructions" })),
			notes: Type.Optional(Type.Array(Type.Object({
				text: Type.String({ description: "Note text" }),
				title: Type.Optional(Type.String({ description: "Note title" })),
			}), { description: "Recipe notes" })),
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
							signal,
						});
						const limited = params.limit ? recipes.slice(0, params.limit) : recipes;
						if (limited.length === 0) {
							return { content: [{ type: "text", text: "No recipes found." }], details: {} };
						}
						const lines = limited.map(formatSummary);
						return { content: [{ type: "text", text: `Found ${limited.length} recipe(s):\n\n${lines.join("\n")}` }], details: {} };
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
						validatePathSegment(params.slug, "slug");
						const recipe = await mealie.get<RecipeDetail>(`/recipes/${params.slug}`, undefined, signal);
						return { content: [{ type: "text", text: formatDetail(recipe) }], details: {} };
					}

					case "create": {
						// Step 1: Create minimal recipe (Mealie POST returns a slug string)
						const createBody: Record<string, unknown> = {};
						if (params.name) createBody.name = params.name;
						if (params.description) createBody.description = params.description;

						const slug = await mealie.post<string>("/recipes", createBody, signal);
						if (!slug) throw new Error("Recipe creation returned no slug");

						const resolvedSlug = typeof slug === "string" ? slug : (slug as unknown as RecipeDetail).slug;
						if (!resolvedSlug) throw new Error("Could not determine recipe slug from create response");
						// Validate server-returned slug — never use an invalid slug in a URL path (path traversal risk)
						if (!/^[\w-]+$/.test(resolvedSlug)) {
							throw new Error(`Invalid slug returned by Mealie: "${resolvedSlug}". Cannot safely clean up — please delete the stub recipe manually.`);
						}

						// Step 2: If additional fields provided, PATCH the recipe
						const patchBody = await buildRecipeBody(params, signal);
						if (Object.keys(patchBody).length > 0) {
							try {
								await mealie.patch<RecipeDetail>(`/recipes/${resolvedSlug}`, patchBody, signal);
							} catch (patchErr: any) {
								// Rollback: delete the stub recipe so we don't leave orphans
								let rolledBack = false;
								try { await mealie.delete(`/recipes/${resolvedSlug}`); rolledBack = true; } catch { /* best-effort */ }
								const suffix = rolledBack
									? "(rolled back)"
									: `ORPHAN stub recipe may remain at slug: "${resolvedSlug}" — please delete it manually`;
								throw new Error(`Recipe created but failed to add details (${suffix}): ${patchErr.message || patchErr}`);
							}
						}

						// Step 3: Fetch the final recipe for display
						try {
							const recipe = await mealie.get<RecipeDetail>(`/recipes/${resolvedSlug}`, undefined, signal);
							return { content: [{ type: "text", text: `✅ Recipe created:\n\n${formatDetail(recipe)}` }], details: {} };
						} catch {
							// Recipe was created and patched successfully; only the display fetch failed
							return { content: [{ type: "text", text: `✅ Recipe created (slug: ${resolvedSlug}). Use \`get\` action with this slug to view details.` }], details: {} };
						}
					}

					case "update": {
						if (!params.slug) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: slug" }], details: {} };
						}
						validatePathSegment(params.slug, "slug");

						const body = await buildRecipeBody(params, signal);
						if (params.name !== undefined) body.name = params.name;
						if (params.description !== undefined) body.description = params.description;

						const recipe = await mealie.patch<RecipeDetail>(`/recipes/${params.slug}`, body, signal);
						return { content: [{ type: "text", text: `✅ Recipe updated:\n\n${formatDetail(recipe)}` }], details: {} };
					}

					case "delete": {
						if (!params.slug) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: slug" }], details: {} };
						}
						validatePathSegment(params.slug, "slug");
						await mealie.delete(`/recipes/${params.slug}`, signal);
						return { content: [{ type: "text", text: `✅ Recipe "${params.slug}" deleted.` }], details: {} };
					}

					case "scrape_url": {
						if (!params.url) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: url" }], details: {} };
						}
						if (!/^https?:\/\//i.test(params.url)) {
							return { content: [{ type: "text", text: "❌ Invalid URL: only http(s) URLs are supported for scraping." }], details: {} };
						}
						let host: string;
						try {
							host = new URL(params.url).hostname;
						} catch {
							return { content: [{ type: "text", text: "❌ Invalid URL format." }], details: {} };
						}
						// WHATWG URL returns IPv6 hostnames bracketed, e.g. "[::ffff:7f00:1]"
						const unbracketed = host.replace(/^\[|\]$/g, "");
						const isPrivate = checkPrivateHost(unbracketed);
						if (isPrivate) {
							return { content: [{ type: "text", text: "❌ URL points to a private/internal address. Only public URLs are allowed for scraping." }], details: {} };
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

/** Look up an organizer item by exact name via search, returning the full object if found. */
async function resolveOrganizerName(path: string, name: string, signal?: AbortSignal): Promise<OrganizerItem | null> {
	try {
		const items = await apiList<OrganizerItem>(path, { params: { search: name }, signal });
		const match = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
		return match ?? null;
	} catch {
		return null;
	}
}

/** Build recipe body fields for PATCH from tool params (excludes name/description which are handled separately).
 *  Resolves tag, category, food, and unit names to full Mealie objects to avoid 422 errors and duplicates. */
async function buildRecipeBody(params: {
	recipeYield?: string;
	servings?: number;
	prepTime?: string;
	cookTime?: string;
	totalTime?: string;
	ingredients?: { note?: string; quantity?: number; unit?: string; food?: string }[];
	instructions?: { text: string; title?: string }[];
	notes?: { text: string; title?: string }[];
	tags?: string[];
	categories?: string[];
}, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const body: Record<string, unknown> = {};

	if (params.recipeYield !== undefined) body.recipeYield = params.recipeYield;
	if (params.servings !== undefined) body.recipeServings = params.servings;
	if (params.prepTime !== undefined) body.prepTime = params.prepTime;
	if (params.cookTime !== undefined) body.cookTime = params.cookTime;
	if (params.totalTime !== undefined) body.totalTime = params.totalTime;

	if (params.ingredients) {
		body.recipeIngredient = [];
		for (const ing of params.ingredients) {
			const entry: Record<string, unknown> = {
				note: ing.note || "",
				quantity: ing.quantity ?? null,
			};
			if (ing.unit) {
				const found = await resolveOrganizerName("/units", ing.unit, signal);
				if (found) {
					entry.unit = { id: found.id, name: found.name };
				} else {
					const created = await mealie.post<OrganizerItem>("/units", { name: ing.unit }, signal);
					entry.unit = { id: created.id, name: created.name };
				}
			}
			if (ing.food) {
				const found = await resolveOrganizerName("/foods", ing.food, signal);
				if (found) {
					entry.food = { id: found.id, name: found.name };
				} else {
					const created = await mealie.post<OrganizerItem>("/foods", { name: ing.food }, signal);
					entry.food = { id: created.id, name: created.name };
				}
			}
			(body.recipeIngredient as Record<string, unknown>[]).push(entry);
		}
	}

	if (params.instructions) {
		body.recipeInstructions = params.instructions.map((step) => ({
			text: step.text,
			title: step.title || "",
			ingredientReferences: [] as { referenceId: string }[],
		}));
	}

	if (params.notes) {
		body.notes = params.notes.map((n) => ({
			text: n.text,
			title: n.title || "",
		}));
	}

	if (params.tags) {
		body.tags = [];
		for (const name of params.tags) {
			const found = await resolveOrganizerName("/organizers/tags", name, signal);
			(body.tags as Record<string, unknown>[]).push(found ? { id: found.id, name: found.name, slug: found.slug } : { name });
		}
	}
	if (params.categories) {
		body.recipeCategory = [];
		for (const name of params.categories) {
			const found = await resolveOrganizerName("/organizers/categories", name, signal);
			(body.recipeCategory as Record<string, unknown>[]).push(found ? { id: found.id, name: found.name, slug: found.slug } : { name });
		}
	}

	return body;
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
	if (r.recipeServings != null) lines.push(`**Servings:** ${r.recipeServings}`);
	if (r.prepTime) lines.push(`**Prep Time:** ${r.prepTime}`);
	if (r.cookTime) lines.push(`**Cook Time:** ${r.cookTime}`);
	if (r.totalTime) lines.push(`**Total Time:** ${r.totalTime}`);
	if (r.rating) lines.push(`**Rating:** ${"⭐".repeat(Math.round(r.rating))} (${r.rating}/5)`);

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

	if (r.recipeIngredient?.length) {
		lines.push(`\n### Ingredients`);
		for (const ing of r.recipeIngredient) {
			const qty = ing.quantity ?? "";
			const unit = ing.unit?.name ? ` ${ing.unit.name}` : "";
			const food = ing.food?.name ? ` ${ing.food.name}` : "";
			const note = ing.note ? ` — ${ing.note}` : "";
			lines.push(`- ${qty}${unit}${food}${note}`);
		}
	}

	if (r.recipeInstructions?.length) {
		lines.push(`\n### Instructions`);
		for (let i = 0; i < r.recipeInstructions.length; i++) {
			const step = r.recipeInstructions[i];
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
