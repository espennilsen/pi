import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getClient, isClientReady } from "../client.ts";
import type { Comment } from "@doist/todoist-api-typescript";

const actionSchema = Type.Union([
  Type.Literal("list"),
  Type.Literal("get"),
  Type.Literal("add"),
  Type.Literal("update"),
  Type.Literal("delete"),
]);

export function registerCommentsTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "todoist_comments",
    description: "Manage Todoist comments — list, get, add, update, and delete comments on tasks and projects",
    parameters: Type.Object({
      action: actionSchema,
      id: Type.Optional(Type.String({ description: "Comment ID (for get/update/delete)" })),
      content: Type.Optional(Type.String({ description: "Comment content (for add/update)" })),
      taskId: Type.Optional(Type.String({ description: "Task ID (for list/add)" })),
      projectId: Type.Optional(Type.String({ description: "Project ID (for list/add)" })),
      attachment: Type.Optional(
        Type.Object({
          fileName: Type.String(),
          fileUrl: Type.String(),
          fileType: Type.String(),
          resourceType: Type.String(),
        }, { description: "Attachment object (for add)" })
      ),
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
            if (!params.taskId && !params.projectId) {
              return { content: [{ type: "text", text: "❌ Must specify either taskId or projectId" }] };
            }

            let comments: Comment[] = [];
            let cursor: string | undefined = undefined;
            
            const queryParams: any = {};
            if (params.taskId) queryParams.taskId = params.taskId;
            if (params.projectId) queryParams.projectId = params.projectId;

            while (true) {
              const response = await client.getComments({ ...queryParams, cursor });
              comments.push(...response.results);
              if (!response.nextCursor) break;
              cursor = response.nextCursor;
            }

            if (comments.length === 0) {
              return { content: [{ type: "text", text: "No comments found." }] };
            }

            const output = comments.map(formatComment).join("\n\n---\n\n");
            return { content: [{ type: "text", text: `Found ${comments.length} comment(s):\n\n${output}` }] };
          }

          case "get": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            const comment = await client.getComment(params.id);
            return { content: [{ type: "text", text: formatComment(comment) }] };
          }

          case "add": {
            if (!params.content) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: content" }] };
            }
            if (!params.taskId && !params.projectId) {
              return { content: [{ type: "text", text: "❌ Must specify either taskId or projectId" }] };
            }

            const addArgs: any = { content: params.content };
            if (params.taskId) addArgs.taskId = params.taskId;
            if (params.projectId) addArgs.projectId = params.projectId;
            if (params.attachment) addArgs.attachment = params.attachment;

            const comment = await client.addComment(addArgs);
            return { content: [{ type: "text", text: `✅ Comment added:\n\n${formatComment(comment)}` }] };
          }

          case "update": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            if (!params.content) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: content" }] };
            }

            const comment = await client.updateComment(params.id, { content: params.content });
            return { content: [{ type: "text", text: `✅ Comment updated:\n\n${formatComment(comment)}` }] };
          }

          case "delete": {
            if (!params.id) {
              return { content: [{ type: "text", text: "❌ Missing required parameter: id" }] };
            }
            await client.deleteComment(params.id);
            return { content: [{ type: "text", text: `✅ Comment ${params.id} deleted` }] };
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

function formatComment(comment: Comment): string {
  const parts: string[] = [];
  
  parts.push(`${comment.content}`);
  parts.push(`- ID: \`${comment.id}\``);
  
  if (comment.taskId) {
    parts.push(`- Task: ${comment.taskId}`);
  }
  
  if (comment.projectId) {
    parts.push(`- Project: ${comment.projectId}`);
  }
  
  if (comment.fileAttachment) {
    parts.push(`- Attachment: [${comment.fileAttachment.fileName}](${comment.fileAttachment.fileUrl})`);
  }
  
  parts.push(`- Posted: ${comment.postedAt}`);
  
  return parts.join("\n");
}
