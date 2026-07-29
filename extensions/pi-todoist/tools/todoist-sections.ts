import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getClient, isClientReady } from "../client.ts";
import type { Section } from "@doist/todoist-api-typescript";

function result(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

const actionSchema = Type.Union([
  Type.Literal("list"),
  Type.Literal("get"),
  Type.Literal("add"),
  Type.Literal("update"),
  Type.Literal("delete"),
]);

export function registerSectionsTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "todoist_sections",
    label: "Todoist Sections",
    description: "Manage Todoist sections — list, get, add, update, and delete sections",
    parameters: Type.Object({
      action: actionSchema,
      id: Type.Optional(Type.String({ description: "Section ID (for get/update/delete)" })),
      name: Type.Optional(Type.String({ description: "Section name (for add/update)" })),
      projectId: Type.Optional(Type.String({ description: "Project ID (for list/add)" })),
      order: Type.Optional(Type.Number({ description: "Section order (for add)" })),
    }),
    execute: async (_toolCallId, params, signal) => {
      if (!isClientReady()) {
        return result("❌ Not configured. Set `pi-todoist.apiToken` in settings.json");
      }

      const client = getClient();

      try {
        switch (params.action) {
          case "list": {
            let sections: Section[] = [];
            let cursor: string | undefined = undefined;

            const queryParams: any = {};
            if (params.projectId) queryParams.projectId = params.projectId;

            while (true) {
              if (signal?.aborted) break;
              const response = await client.getSections({ ...queryParams, cursor });
              sections.push(...response.results);
              if (!response.nextCursor) break;
              cursor = response.nextCursor;
            }

            if (sections.length === 0) {
              return result("No sections found.");
            }

            const output = sections.map(formatSection).join("\n\n---\n\n");
            return { content: [{ type: "text", text: `Found ${sections.length} section(s):\n\n${output}` }], details: {} };
          }

          case "get": {
            if (!params.id) {
              return result("❌ Missing required parameter: id");
            }
            const section = await client.getSection(params.id);
            return { content: [{ type: "text", text: formatSection(section) }], details: {} };
          }

          case "add": {
            if (!params.name) {
              return result("❌ Missing required parameter: name");
            }
            if (!params.projectId) {
              return result("❌ Missing required parameter: projectId");
            }

            const addArgs: any = {
              name: params.name,
              projectId: params.projectId,
            };
            if (params.order !== undefined) addArgs.order = params.order;

            const section = await client.addSection(addArgs);
            return { content: [{ type: "text", text: `✅ Section created:\n\n${formatSection(section)}` }], details: {} };
          }

          case "update": {
            if (!params.id) {
              return result("❌ Missing required parameter: id");
            }

            const updateArgs: any = {};
            if (params.name !== undefined) updateArgs.name = params.name;

            if (Object.keys(updateArgs).length === 0) {
              return result("❌ No fields to update provided");
            }

            const section = await client.updateSection(params.id, updateArgs);
            return { content: [{ type: "text", text: `✅ Section updated:\n\n${formatSection(section)}` }], details: {} };
          }

          case "delete": {
            if (!params.id) {
              return result("❌ Missing required parameter: id");
            }
            await client.deleteSection(params.id);
            return { content: [{ type: "text", text: `✅ Section ${params.id} deleted` }], details: {} };
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

function formatSection(section: Section): string {
  const parts: string[] = [];

  parts.push(`**${section.name}**`);
  parts.push(`- ID: \`${section.id}\``);
  parts.push(`- Project: ${section.projectId}`);
  parts.push(`- Order: ${section.sectionOrder}`);

  return parts.join("\n");
}
