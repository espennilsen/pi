import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getClient, isClientReady } from "../client.ts";
import type { Task } from "@doist/todoist-api-typescript";

const actionSchema = Type.Union([
  Type.Literal("list"),
  Type.Literal("get"),
  Type.Literal("add"),
  Type.Literal("update"),
  Type.Literal("close"),
  Type.Literal("reopen"),
  Type.Literal("delete"),
  Type.Literal("move"),
  Type.Literal("search"),
]);

export function registerTasksTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "todoist_tasks",
    description: "Manage Todoist tasks — list, get, add, update, complete, reopen, delete, move, and search tasks",
    parameters: Type.Object({
      action: actionSchema,
      id: Type.Optional(Type.String({ description: "Task ID (for get/update/close/reopen/delete/move)" })),
      content: Type.Optional(Type.String({ description: "Task content/title (for add/update)" })),
      description: Type.Optional(Type.String({ description: "Task description (for add/update)" })),
      projectId: Type.Optional(Type.String({ description: "Project ID (for list/add/update/move)" })),
      sectionId: Type.Optional(Type.String({ description: "Section ID (for list/add/update/move)" })),
      parentId: Type.Optional(Type.String({ description: "Parent task ID for subtasks (for add/update/move)" })),
      label: Type.Optional(Type.String({ description: "Label name to filter by (for list)" })),
      labels: Type.Optional(Type.Array(Type.String(), { description: "Label names (for add/update)" })),
      priority: Type.Optional(Type.Number({ description: "Priority: 1=normal, 2=medium, 3=high, 4=urgent (for add/update)" })),
      dueString: Type.Optional(Type.String({ description: "Due date in natural language like 'tomorrow', 'next Monday' (for add/update)" })),
      dueDatetime: Type.Optional(Type.String({ description: "Due datetime in RFC3339 format (for add/update)" })),
      dueDate: Type.Optional(Type.String({ description: "Due date in YYYY-MM-DD format (for add/update)" })),
      duration: Type.Optional(Type.Number({ description: "Task duration amount (for add/update)" })),
      durationUnit: Type.Optional(Type.Union([Type.Literal("minute"), Type.Literal("day")], { description: "Duration unit (for add/update)" })),
      filter: Type.Optional(Type.String({ description: "Todoist filter string like 'today', 'p1', '#Project' (for list)" })),
      query: Type.Optional(Type.String({ description: "Search query for completed tasks (for search)" })),
      limit: Type.Optional(Type.Number({ description: "Max number of results (for list/search)" })),
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
            let tasks: Task[] = [];
            
            if (params.filter) {
              // Use filter-based query
              let cursor: string | undefined = undefined;
              while (true) {
                if (signal?.aborted) break;
                const response = await client.getTasksByFilter({ query: params.filter, cursor });
                tasks.push(...response.results);
                if (!response.nextCursor || (params.limit && tasks.length >= params.limit)) break;
                cursor = response.nextCursor;
              }
            } else {
              // Use parameters-based query
              const queryParams: any = {};
              if (params.projectId) queryParams.projectId = params.projectId;
              if (params.sectionId) queryParams.sectionId = params.sectionId;
              if (params.label) queryParams.label = params.label;
              
              let cursor: string | undefined = undefined;
              while (true) {
                if (signal?.aborted) break;
                const response = await client.getTasks({ ...queryParams, cursor });
                tasks.push(...response.results);
                if (!response.nextCursor || (params.limit && tasks.length >= params.limit)) break;
                cursor = response.nextCursor;
              }
            }

            if (params.limit) {
              tasks = tasks.slice(0, params.limit);
            }

            if (tasks.length === 0) {
              return { content: [{ type: "text", text: "No tasks found." }] };
            }

            const output = tasks.map(formatTask).join("\n\n---\n\n");
            return { content: [{ type: "text", text: `Found ${tasks.length} task(s):\n\n${output}` }] };
          }

          case "get": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            const task = await client.getTask(params.id);
            return { content: [{ type: "text", text: formatTask(task) }] };
          }

          case "add": {
            if (!params.content) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: content" }] };
            }

            const addArgs: any = { content: params.content };
            if (params.description) addArgs.description = params.description;
            if (params.projectId) addArgs.projectId = params.projectId;
            if (params.sectionId) addArgs.sectionId = params.sectionId;
            if (params.parentId) addArgs.parentId = params.parentId;
            if (params.labels) addArgs.labels = params.labels;
            if (params.priority) addArgs.priority = params.priority;
            if (params.dueString) addArgs.dueString = params.dueString;
            if (params.dueDatetime) addArgs.dueDatetime = params.dueDatetime;
            if (params.dueDate) addArgs.dueDate = params.dueDate;
            if (params.duration !== undefined) addArgs.duration = params.duration;
            if (params.durationUnit) addArgs.durationUnit = params.durationUnit;

            const task = await client.addTask(addArgs);
            return { content: [{ type: "text", text: `✅ Task created:\n\n${formatTask(task)}` }] };
          }

          case "update": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }

            const updateArgs: any = {};
            if (params.content !== undefined) updateArgs.content = params.content;
            if (params.description !== undefined) updateArgs.description = params.description;
            if (params.labels) updateArgs.labels = params.labels;
            if (params.priority) updateArgs.priority = params.priority;
            if (params.dueString) updateArgs.dueString = params.dueString;
            if (params.dueDatetime) updateArgs.dueDatetime = params.dueDatetime;
            if (params.dueDate) updateArgs.dueDate = params.dueDate;
            if (params.duration !== undefined) updateArgs.duration = params.duration;
            if (params.durationUnit) updateArgs.durationUnit = params.durationUnit;

            if (Object.keys(updateArgs).length === 0) {
              return { content: [{ type: "text", text: "❌ No fields to update provided" }] };
            }

            const task = await client.updateTask(params.id, updateArgs);
            return { content: [{ type: "text", text: `✅ Task updated:\n\n${formatTask(task)}` }] };
          }

          case "close": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            await client.closeTask(params.id);
            return { content: [{ type: "text", text: `✅ Task ${params.id} completed` }] };
          }

          case "reopen": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            await client.reopenTask(params.id);
            return { content: [{ type: "text", text: `✅ Task ${params.id} reopened` }] };
          }

          case "delete": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            await client.deleteTask(params.id);
            return { content: [{ type: "text", text: `✅ Task ${params.id} deleted` }] };
          }

          case "move": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            const destinations = [params.projectId, params.sectionId, params.parentId].filter(Boolean);
            if (destinations.length !== 1) {
              return { content: [{ type: "text", text: "❌ Must specify exactly one of: projectId, sectionId, parentId" }] };
            }

            const moveArgs: any = {};
            if (params.projectId) moveArgs.projectId = params.projectId;
            if (params.sectionId) moveArgs.sectionId = params.sectionId;
            if (params.parentId) moveArgs.parentId = params.parentId;

            const task = await client.moveTask(params.id, moveArgs);
            return { content: [{ type: "text", text: `✅ Task moved:\n\n${formatTask(task)}` }] };
          }

          case "search": {
            if (!params.query) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: query" }] };
            }

            let allItems: Task[] = [];
            let cursor: string | undefined = undefined;
            while (true) {
              if (signal?.aborted) break;
              const results = await client.searchCompletedTasks({ query: params.query, cursor });
              allItems.push(...results.items);
              if (!results.nextCursor || (params.limit && allItems.length >= params.limit)) break;
              cursor = results.nextCursor;
            }

            if (allItems.length === 0) {
              return { content: [{ type: "text", text: "No completed tasks found." }] };
            }

            let tasks = allItems;
            if (params.limit) {
              tasks = tasks.slice(0, params.limit);
            }

            const output = tasks.map(task => {
              return `**${task.content}**\n- ID: \`${task.id}\`\n- Completed: ${task.completedAt || 'N/A'}\n- Project: ${task.projectId || 'None'}`;
            }).join("\n\n");

            return { content: [{ type: "text", text: `Found ${tasks.length} completed task(s):\n\n${output}` }] };
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

function formatTask(task: Task): string {
  const parts: string[] = [];
  
  parts.push(`**${task.content}**`);
  parts.push(`- ID: \`${task.id}\``);
  
  if (task.description) {
    parts.push(`- Description: ${task.description}`);
  }
  
  if (task.projectId) {
    parts.push(`- Project: ${task.projectId}`);
  }
  
  if (task.sectionId) {
    parts.push(`- Section: ${task.sectionId}`);
  }
  
  if (task.parentId) {
    parts.push(`- Parent: ${task.parentId}`);
  }
  
  if (task.labels && task.labels.length > 0) {
    parts.push(`- Labels: ${task.labels.join(", ")}`);
  }
  
  if (task.priority > 1) {
    const priorityName = ["", "normal", "medium", "high", "urgent"][task.priority] || "unknown";
    parts.push(`- Priority: ${priorityName} (${task.priority})`);
  }
  
  if (task.due) {
    parts.push(`- Due: ${task.due.date}${task.due.datetime ? ` at ${task.due.datetime}` : ""}`);
  }
  
  if (task.duration) {
    parts.push(`- Duration: ${task.duration.amount} ${task.duration.unit}(s)`);
  }
  
  parts.push(`- URL: ${task.url}`);
  
  return parts.join("\n");
}
