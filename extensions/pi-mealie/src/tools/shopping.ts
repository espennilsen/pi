/**
 * mealie_shopping tool — Shopping lists: view lists, add/check items.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { isClientReady, mealie, apiList } from "../client.ts";

/** Validate a path segment contains only safe characters. */
function validatePathSegment(value: string, name: string): void {
	if (!/^[\w-]+$/.test(value)) {
		throw new Error(`Invalid ${name}: "${value}". Only alphanumeric, hyphens, and underscores allowed.`);
	}
}

interface ShoppingList {
	id: string;
	name: string;
	groupId: string;
}

interface ShoppingListItem {
	id: string;
	shoppingListId: string;
	checked: boolean;
	position: number;
	isFood: boolean;
	food: { id: string; name: string; description: string | null } | null;
	unit: { id: string; name: string; description: string | null } | null;
	quantity: number;
	note: string;
	recipeReferences: { recipeSlug: string; recipeName: string; recipeId: string }[];
}

const actionSchema = Type.Union([
	Type.Literal("lists"),
	Type.Literal("items"),
	Type.Literal("add_item"),
	Type.Literal("check_item"),
	Type.Literal("uncheck_item"),
	Type.Literal("delete_item"),
]);

export function registerShoppingTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "mealie_shopping",
		label: "Mealie Shopping",
		description: "Manage Mealie shopping lists — view lists, see items, add/check/uncheck/delete items",
		parameters: Type.Object({
			action: actionSchema,
			listId: Type.Optional(Type.String({ description: "Shopping list ID (defaults to first list)" })),
			itemId: Type.Optional(Type.String({ description: "Item ID (for check/uncheck/delete)" })),
			note: Type.Optional(Type.String({ description: "Item note text" })),
			quantity: Type.Optional(Type.Number({ description: "Quantity (for add_item)" })),
			foodName: Type.Optional(Type.String({ description: "Food name (for add_item)" })),
			unitName: Type.Optional(Type.String({ description: "Unit name (for add_item)" })),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
			if (!isClientReady()) {
				return {
					content: [{ type: "text", text: "❌ Not configured. Set `pi-mealie.baseUrl` and `pi-mealie.apiToken` in settings.json" }],
					details: {},
				};
			}

			try {
				// Helper: resolve list ID
				const resolveListId = async (): Promise<string | null> => {
					if (params.listId) return params.listId;
					const lists = await apiList<ShoppingList>("/households/shopping/lists", { signal });
					return lists[0]?.id ?? null;
				};

				switch (params.action) {
					case "lists": {
						const lists = await apiList<ShoppingList>("/households/shopping/lists", { signal });
						if (lists.length === 0) {
							return { content: [{ type: "text", text: "No shopping lists found. Create one in Mealie first." }], details: {} };
						}
						const lines = lists.map((l) => `- **${l.name}** (id: \`${l.id}\`)`);
						return { content: [{ type: "text", text: `🛒 **Shopping Lists**\n\n${lines.join("\n")}` }], details: {} };
					}

					case "items": {
						const listId = await resolveListId();
						if (!listId) {
							return { content: [{ type: "text", text: "❌ No shopping list found. Provide listId or create a list in Mealie." }], details: {} };
						}
						const items = await apiList<ShoppingListItem>(`/households/shopping/items`, {
							params: { shopping_list_id: listId },
							signal,
						});
						if (items.length === 0) {
							return { content: [{ type: "text", text: "Shopping list is empty." }], details: {} };
						}

						const unchecked = items.filter((i) => !i.checked);
						const checked = items.filter((i) => i.checked);

						const lines: string[] = [];
						if (unchecked.length) {
							lines.push("**☐ To Buy**");
							for (const item of unchecked) {
								lines.push(formatItem(item));
							}
						}
						if (checked.length) {
							lines.push(`\n**☑ Bought** (${checked.length})`);
							for (const item of checked) {
								lines.push(formatItem(item));
							}
						}
						return { content: [{ type: "text", text: `🛒 **Shopping List**\n\n${lines.join("\n")}` }], details: {} };
					}

					case "add_item": {
						const listId = await resolveListId();
						if (!listId) {
							return { content: [{ type: "text", text: "❌ No shopping list found." }], details: {} };
						}
						const body: Record<string, unknown> = {
							shoppingListId: listId,
							note: params.note || params.foodName || "",
							quantity: params.quantity || 1,
						};
						if (params.foodName) body.foodName = params.foodName;
						if (params.unitName) body.unitName = params.unitName;

						const item = await mealie.post<ShoppingListItem>("/households/shopping/items", body, signal);
						return { content: [{ type: "text", text: `✅ Item added to shopping list:\n\n${formatItem(item)}` }], details: {} };
					}

					case "check_item": {
						if (!params.itemId) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: itemId" }], details: {} };
						}
						validatePathSegment(params.itemId, "itemId");
						await mealie.patch(`/households/shopping/items/${params.itemId}`, { checked: true }, signal);
						return { content: [{ type: "text", text: `☑ Item ${params.itemId} checked off.` }], details: {} };
					}

					case "uncheck_item": {
						if (!params.itemId) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: itemId" }], details: {} };
						}
						validatePathSegment(params.itemId, "itemId");
						await mealie.patch(`/households/shopping/items/${params.itemId}`, { checked: false }, signal);
						return { content: [{ type: "text", text: `☐ Item ${params.itemId} unchecked.` }], details: {} };
					}

					case "delete_item": {
						if (!params.itemId) {
							return { content: [{ type: "text", text: "❌ Missing required parameter: itemId" }], details: {} };
						}
						validatePathSegment(params.itemId, "itemId");
						await mealie.delete(`/households/shopping/items/${params.itemId}`, signal);
						return { content: [{ type: "text", text: `✅ Item ${params.itemId} deleted from list.` }], details: {} };
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

function formatItem(item: ShoppingListItem): string {
	const qty = item.quantity !== 1 ? `${item.quantity} ` : "";
	const unit = item.unit?.name ? ` ${item.unit.name}` : "";
	const food = item.food?.name || "";
	const note = item.note ? ` — ${item.note}` : "";
	const refs = item.recipeReferences?.length
		? ` (from: ${item.recipeReferences.map((r) => r.recipeName).join(", ")})`
		: "";
	return `- ${qty}${food}${unit}${note}${refs}`;
}