import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getClient, isClientReady } from "../client.ts";
import type { Label } from "@doist/todoist-api-typescript";

const actionSchema = Type.Union([
  Type.Literal("list"),
  Type.Literal("get"),
  Type.Literal("add"),
  Type.Literal("update"),
  Type.Literal("delete"),
]);

export function registerLabelsTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "todoist_labels",
    description: "Manage Todoist labels — list, get, add, update, and delete labels",
    parameters: Type.Object({
      action: actionSchema,
      id: Type.Optional(Type.String({ description: "Label ID (for get/update/delete)" })),
      name: Type.Optional(Type.String({ description: "Label name (for add/update)" })),
      color: Type.Optional(Type.String({ description: "Label color (for add/update)" })),
      order: Type.Optional(Type.Number({ description: "Label order (for add/update)" })),
      isFavorite: Type.Optional(Type.Boolean({ description: "Mark as favorite (for add/update)" })),
    }),
    execute: async (params, { signal }) => {
      if (!isClientReady()) {
        return {
          content: [{ type: "text", text: "❌ Not configured. Set `pi-todoist.apiToken` in settings.json" }],
        };
      }

      const client = getClient();

      try {
        switch (params.action) {
          case "list": {
            let labels: Label[] = [];
            let cursor: string | undefined = undefined;
            
            while (true) {
              if (signal?.aborted) break;
              const response = await client.getLabels({ cursor });
              labels.push(...response.results);
              if (!response.nextCursor) break;
              cursor = response.nextCursor;
            }

            if (labels.length === 0) {
              return { content: [{ type: "text", text: "No labels found." }] };
            }

            const output = labels.map(formatLabel).join("\n\n---\n\n");
            return { content: [{ type: "text", text: `Found ${labels.length} label(s):\n\n${output}` }] };
          }

          case "get": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            const label = await client.getLabel(params.id);
            return { content: [{ type: "text", text: formatLabel(label) }] };
          }

          case "add": {
            if (!params.name) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: name" }] };
            }

            const addArgs: any = { name: params.name };
            if (params.color) addArgs.color = params.color;
            if (params.order !== undefined) addArgs.order = params.order;
            if (params.isFavorite !== undefined) addArgs.isFavorite = params.isFavorite;

            const label = await client.addLabel(addArgs);
            return { content: [{ type: "text", text: `✅ Label created:\n\n${formatLabel(label)}` }] };
          }

          case "update": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }

            const updateArgs: any = {};
            if (params.name) updateArgs.name = params.name;
            if (params.color) updateArgs.color = params.color;
            if (params.order !== undefined) updateArgs.order = params.order;
            if (params.isFavorite !== undefined) updateArgs.isFavorite = params.isFavorite;

            if (Object.keys(updateArgs).length === 0) {
              return { content: [{ type: "text", text: "❌ No fields to update provided" }] };
            }

            const label = await client.updateLabel(params.id, updateArgs);
            return { content: [{ type: "text", text: `✅ Label updated:\n\n${formatLabel(label)}` }] };
          }

          case "delete": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            await client.deleteLabel(params.id);
            return { content: [{ type: "text", text: `✅ Label ${params.id} deleted` }] };
          }

          default:
            return { content: [{ type: "text", text: `❌ Unknown action: ${params.action}` }] };
        }
      } catch (error: any) {
        return { content: [{ type: "text", text: `❌ Error: ${error.message || String(error)}` }] };
      }
    },
  });
}

function formatLabel(label: Label): string {
  const parts: string[] = [];
  
  parts.push(`**${label.name}**`);
  parts.push(`- ID: \`${label.id}\``);
  
  if (label.color) {
    parts.push(`- Color: ${label.color}`);
  }
  
  parts.push(`- Order: ${label.order}`);
  
  if (label.isFavorite) {
    parts.push(`- ⭐ Favorite`);
  }
  
  return parts.join("\n");
}
