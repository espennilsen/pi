import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getClient, isClientReady } from "../client.ts";
import type { Comment } from "@doist/todoist-api-typescript";

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

export function registerCommentsTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "todoist_comments",
    label: "Todoist Comments",
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
    execute: async (_toolCallId, params, signal) => {
      if (!isClientReady()) {
        return result("❌ Not configured. Set `pi-todoist.apiToken` in settings.json");
      }

      const client = getClient();

      try {
        switch (params.action) {
          case "list": {
            if (!params.taskId && !params.projectId) {
              return result("❌ Must specify either taskId or projectId");
            }

            let comments: Comment[] = [];
            let cursor: string | undefined = undefined;

            const queryParams: any = {};
            if (params.taskId) queryParams.taskId = params.taskId;
            if (params.projectId) queryParams.projectId = params.projectId;

            while (true) {
              if (signal?.aborted) break;
              const response = await client.getComments({ ...queryParams, cursor });
              comments.push(...response.results);
              if (!response.nextCursor) break;
              cursor = response.nextCursor;
            }

            if (comments.length === 0) {
              return result("No comments found.");
            }

            const output = comments.map(formatComment).join("\n\n---\n\n");
            return { content: [{ type: "text", text: `Found ${comments.length} comment(s):\n\n${output}` }], details: {} };
          }

          case "get": {
            if (!params.id) {
              return result("❌ Missing required parameter: id");
            }
            const comment = await client.getComment(params.id);
            return { content: [{ type: "text", text: formatComment(comment) }], details: {} };
          }

          case "add": {
            if (!params.content) {
              return result("❌ Missing required parameter: content");
            }
            if (!params.taskId && !params.projectId) {
              return result("❌ Must specify either taskId or projectId");
            }

            const addArgs: any = { content: params.content };
            if (params.taskId) addArgs.taskId = params.taskId;
            if (params.projectId) addArgs.projectId = params.projectId;
            if (params.attachment) addArgs.attachment = params.attachment;

            const comment = await client.addComment(addArgs);
            return { content: [{ type: "text", text: `✅ Comment added:\n\n${formatComment(comment)}` }], details: {} };
          }

          case "update": {
            if (!params.id) {
              return result("❌ Missing required parameter: id");
            }
            if (!params.content) {
              return result("❌ Missing required parameter: content");
            }

            const comment = await client.updateComment(params.id, { content: params.content });
            return { content: [{ type: "text", text: `✅ Comment updated:\n\n${formatComment(comment)}` }], details: {} };
          }

          case "delete": {
            if (!params.id) {
              return result("❌ Missing required parameter: id");
            }
            await client.deleteComment(params.id);
            return { content: [{ type: "text", text: `✅ Comment ${params.id} deleted` }], details: {} };
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
