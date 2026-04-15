/**
 * mealie_organizer tool — Tags, categories, tools, foods, and units.
 */

import type { ExtensionAPI, AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { isClientReady, mealie, apiList } from "../client.ts";

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
]);

export function registerOrganizerTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "mealie_organizer",
		label: "Mealie Organizer",
		description: "Manage Mealie organizers — list/create tags, categories, tools, foods, and units",
		parameters: Type.Object({
			action: actionSchema,
			name: Type.Optional(Type.String({ description: "Name (for create actions)" })),
			description: Type.Optional(Type.String({ description: "Description (for create actions)" })),
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
					case "list_tags": return await listItems("Tags", "/organizers/tags", "🏷️", signal);
					case "list_categories": return await listItems("Categories", "/organizers/categories", "📁", signal);
					case "list_tools": return await listItems("Tools", "/organizers/tools", "🔧", signal);
					case "list_foods": return await listItems("Foods", "/foods", "🥕", signal);
					case "list_units": return await listItems("Units", "/units", "📏", signal);

					case "create_tag": return await createItem("Tag", "/organizers/tags", params, signal);
					case "create_category": return await createItem("Category", "/organizers/categories", params, signal);
					case "create_tool": return await createItem("Tool", "/organizers/tools", params, signal);
					case "create_food": return await createItem("Food", "/foods", params, signal);
					case "create_unit": return await createItem("Unit", "/units", params, signal);

					default:
						return { content: [{ type: "text", text: `❌ Unknown action: ${params.action}` }], details: {} };
				}
			} catch (error: any) {
				return { content: [{ type: "text", text: `❌ Error: ${error.message || String(error)}` }], details: {} };
			}
		},
	});
}

async function listItems(label: string, path: string, icon: string, signal?: AbortSignal): Promise<AgentToolResult<{}>> {
	const items = await apiList<OrganizerItem>(path, { signal });
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
	return { content: [{ type: "text" as const, text: `✅ ${label} "${item.name}" created (_${item.slug}_, id: \`${item.id}\`)` }], details: {} };
}