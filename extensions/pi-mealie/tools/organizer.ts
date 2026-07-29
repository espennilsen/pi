/**
 * mealie_organizer tool — Tags, categories, tools, foods, and units.
 */

import type { ExtensionAPI, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isClientReady, mealie, apiList } from "../client.ts";

/** Validate a path segment (UUID or slug) contains only safe characters. */
function validatePathSegment(value: string, name: string): void {
	if (!/^[\w-]+$/.test(value)) {
		throw new Error(`Invalid ${name}: "${value}". Only alphanumeric, hyphens, and underscores allowed.`);
	}
}

interface OrganizerItem {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	groupId: string;
}

const actionSchema = Type.Union([
	Type.Literal("list_tags"),
	Type.Literal("list_categories"),
	Type.Literal("list_tools"),
	Type.Literal("list_foods"),
	Type.Literal("list_units"),
	Type.Literal("create_tag"),
	Type.Literal("create_category"),
	Type.Literal("create_tool"),
	Type.Literal("create_food"),
	Type.Literal("create_unit"),
	Type.Literal("update_tag"),
	Type.Literal("update_category"),
	Type.Literal("update_tool"),
	Type.Literal("update_food"),
	Type.Literal("update_unit"),
	Type.Literal("delete_tag"),
	Type.Literal("delete_category"),
	Type.Literal("delete_tool"),
	Type.Literal("delete_food"),
	Type.Literal("delete_unit"),
]);

export function registerOrganizerTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "mealie_organizer",
		label: "Mealie Organizer",
		description: "Manage Mealie organizers — list/create/update/delete tags, categories, tools, foods, and units",
		parameters: Type.Object({
			action: actionSchema,
			id: Type.Optional(Type.String({ description: "Item ID (for update/delete actions)" })),
			name: Type.Optional(Type.String({ description: "Name (for create/update actions)" })),
			description: Type.Optional(Type.String({ description: "Description (for create/update actions)" })),
			query: Type.Optional(Type.String({ description: "Search query (for list_foods, list_units)" })),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
			if (!isClientReady()) {
				return {
					content: [{ type: "text", text: "❌ Not configured. Set `pi-mealie.baseUrl` and `pi-mealie.apiToken` in settings.json" }],
					details: {},
				};
			}

			try {
				switch (params.action) {
					// List
					case "list_tags": return await listItems("Tags", "/organizers/tags", "🏷️", signal);
					case "list_categories": return await listItems("Categories", "/organizers/categories", "📁", signal);
					case "list_tools": return await listItems("Tools", "/organizers/tools", "🔧", signal);
					case "list_foods": return await listItems("Foods", "/foods", "🥕", signal, params.query);
					case "list_units": return await listItems("Units", "/units", "📏", signal, params.query);

					// Create
					case "create_tag": return await createItem("Tag", "/organizers/tags", params, signal);
					case "create_category": return await createItem("Category", "/organizers/categories", params, signal);
					case "create_tool": return await createItem("Tool", "/organizers/tools", params, signal);
					case "create_food": return await createItem("Food", "/foods", params, signal);
					case "create_unit": return await createItem("Unit", "/units", params, signal);

					// Update
					case "update_tag": return await updateItem("Tag", "/organizers/tags", params, signal);
					case "update_category": return await updateItem("Category", "/organizers/categories", params, signal);
					case "update_tool": return await updateItem("Tool", "/organizers/tools", params, signal);
					case "update_food": return await updateItem("Food", "/foods", params, signal);
					case "update_unit": return await updateItem("Unit", "/units", params, signal);

					// Delete
					case "delete_tag": return await deleteItem("Tag", "/organizers/tags", params, signal);
					case "delete_category": return await deleteItem("Category", "/organizers/categories", params, signal);
					case "delete_tool": return await deleteItem("Tool", "/organizers/tools", params, signal);
					case "delete_food": return await deleteItem("Food", "/foods", params, signal);
					case "delete_unit": return await deleteItem("Unit", "/units", params, signal);

					default:
						return { content: [{ type: "text", text: `❌ Unknown action: ${params.action}` }], details: {} };
				}
			} catch (error: any) {
				return { content: [{ type: "text", text: `❌ Error: ${error.message || String(error)}` }], details: {} };
			}
		},
	});
}

async function listItems(label: string, path: string, icon: string, signal?: AbortSignal, search?: string): Promise<AgentToolResult<{}>> {
	const items = await apiList<OrganizerItem>(path, {
		params: search ? { search } : undefined,
		signal,
	});
	if (items.length === 0) {
		return { content: [{ type: "text" as const, text: `No ${label.toLowerCase()} found.` }], details: {} };
	}
	const lines = items.map((i) => `- ${icon} **${i.name}** (_${i.slug}_)${i.description ? ` — ${i.description}` : ""} (id: \`${i.id}\`)`);
	return { content: [{ type: "text" as const, text: `${icon} **${label}** (${items.length})\n\n${lines.join("\n")}` }], details: {} };
}

async function createItem(label: string, path: string, params: { name?: string; description?: string }, signal?: AbortSignal): Promise<AgentToolResult<{}>> {
	if (!params.name) {
		return { content: [{ type: "text" as const, text: `❌ Missing required parameter: name` }], details: {} };
	}
	const body: Record<string, unknown> = { name: params.name };
	if (params.description) body.description = params.description;

	const item = await mealie.post<OrganizerItem>(path, body, signal);
	if (!item?.id) throw new Error(`${label} API returned no data`);
	return { content: [{ type: "text" as const, text: `✅ ${label} "${item.name}" created (_${item.slug}_, id: \`${item.id}\`)` }], details: {} };
}

async function updateItem(label: string, path: string, params: { id?: string; name?: string; description?: string }, signal?: AbortSignal): Promise<AgentToolResult<{}>> {
	if (!params.id) {
		return { content: [{ type: "text" as const, text: `❌ Missing required parameter: id` }], details: {} };
	}
	validatePathSegment(params.id, "id");
	if (!params.name && params.description === undefined) {
		return { content: [{ type: "text" as const, text: `❌ Provide at least one of: name, description` }], details: {} };
	}
	const body: Record<string, unknown> = { id: params.id };
	if (params.name !== undefined) body.name = params.name;
	if (params.description !== undefined) body.description = params.description;

	const item = await mealie.put<OrganizerItem>(`${path}/${params.id}`, body, signal);
	if (!item?.id) throw new Error(`${label} API returned no data`);
	return { content: [{ type: "text" as const, text: `✅ ${label} updated: "${item.name}" (_${item.slug}_, id: \`${item.id}\`)` }], details: {} };
}

async function deleteItem(label: string, path: string, params: { id?: string }, signal?: AbortSignal): Promise<AgentToolResult<{}>> {
	if (!params.id) {
		return { content: [{ type: "text" as const, text: `❌ Missing required parameter: id` }], details: {} };
	}
	validatePathSegment(params.id, "id");

	await mealie.delete(`${path}/${params.id}`, signal);
	return { content: [{ type: "text" as const, text: `✅ ${label} \`${params.id}\` deleted.` }], details: {} };
}
