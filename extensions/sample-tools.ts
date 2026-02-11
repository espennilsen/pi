import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "example_tool",
    label: "Example Tool",
    description: "Echo input back to the user. Replace with your own tool.",
    parameters: Type.Object({
      input: Type.String({ description: "Text to echo" }),
    }),
    async execute(_toolCallId, params) {
      const result = `Echo: ${params.input}`;
      return {
        content: [{ type: "text", text: result }],
        details: { input: params.input },
      };
    },
  });

  pi.registerCommand("example-tool", {
    description: "Example command for the sample tool",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Example command args: ${args ?? ""}`.trim(), "info");
    },
  });
}
