import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getClient, isClientReady } from "../client.ts";
import type { PersonalProject, WorkspaceProject } from "@doist/todoist-api-typescript";

const actionSchema = Type.Union([
  Type.Literal("list"),
  Type.Literal("get"),
  Type.Literal("add"),
  Type.Literal("update"),
  Type.Literal("delete"),
  Type.Literal("archive"),
  Type.Literal("unarchive"),
]);

export function registerProjectsTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "todoist_projects",
    description: "Manage Todoist projects — list, get, add, update, delete, archive, and unarchive projects",
    parameters: Type.Object({
      action: actionSchema,
      id: Type.Optional(Type.String({ description: "Project ID (for get/update/delete/archive/unarchive)" })),
      name: Type.Optional(Type.String({ description: "Project name (for add/update)" })),
      color: Type.Optional(Type.String({ description: "Project color (for add/update)" })),
      parentId: Type.Optional(Type.String({ description: "Parent project ID for nested projects (for add)" })),
      viewStyle: Type.Optional(Type.Union([Type.Literal("list"), Type.Literal("board")], { description: "View style (for add/update)" })),
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
            let projects: (PersonalProject | WorkspaceProject)[] = [];
            let cursor: string | undefined = undefined;
            
            while (true) {
              if (signal?.aborted) break;
              const response = await client.getProjects({ cursor });
              projects.push(...response.results);
              if (!response.nextCursor) break;
              cursor = response.nextCursor;
            }

            if (projects.length === 0) {
              return { content: [{ type: "text", text: "No projects found." }] };
            }

            const output = projects.map(formatProject).join("\n\n---\n\n");
            return { content: [{ type: "text", text: `Found ${projects.length} project(s):\n\n${output}` }] };
          }

          case "get": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            const project = await client.getProject(params.id);
            return { content: [{ type: "text", text: formatProject(project) }] };
          }

          case "add": {
            if (!params.name) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: name" }] };
            }

            const addArgs: any = { name: params.name };
            if (params.color) addArgs.color = params.color;
            if (params.parentId) addArgs.parentId = params.parentId;
            if (params.viewStyle) addArgs.viewStyle = params.viewStyle;
            if (params.isFavorite !== undefined) addArgs.isFavorite = params.isFavorite;

            const project = await client.addProject(addArgs);
            return { content: [{ type: "text", text: `✅ Project created:\n\n${formatProject(project)}` }] };
          }

          case "update": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }

            const updateArgs: any = {};
            if (params.name) updateArgs.name = params.name;
            if (params.color) updateArgs.color = params.color;
            if (params.viewStyle) updateArgs.viewStyle = params.viewStyle;
            if (params.isFavorite !== undefined) updateArgs.isFavorite = params.isFavorite;

            if (Object.keys(updateArgs).length === 0) {
              return { content: [{ type: "text", text: "❌ No fields to update provided" }] };
            }

            const project = await client.updateProject(params.id, updateArgs);
            return { content: [{ type: "text", text: `✅ Project updated:\n\n${formatProject(project)}` }] };
          }

          case "delete": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            await client.deleteProject(params.id);
            return { content: [{ type: "text", text: `✅ Project ${params.id} deleted` }] };
          }

          case "archive": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            await client.archiveProject(params.id);
            return { content: [{ type: "text", text: `✅ Project ${params.id} archived` }] };
          }

          case "unarchive": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            await client.unarchiveProject(params.id);
            return { content: [{ type: "text", text: `✅ Project ${params.id} unarchived` }] };
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

function formatProject(project: PersonalProject | WorkspaceProject): string {
  const parts: string[] = [];
  
  parts.push(`**${project.name}**`);
  parts.push(`- ID: \`${project.id}\``);
  
  if (project.color) {
    parts.push(`- Color: ${project.color}`);
  }
  
  // Only PersonalProject has parentId
  if ('parentId' in project && project.parentId) {
    parts.push(`- Parent: ${project.parentId}`);
  }
  
  if (project.viewStyle) {
    parts.push(`- View: ${project.viewStyle}`);
  }
  
  if (project.isFavorite) {
    parts.push(`- ⭐ Favorite`);
  }
  
  if (project.isArchived) {
    parts.push(`- 📦 Archived`);
  }
  
  parts.push(`- URL: ${project.url}`);
  
  return parts.join("\n");
}
