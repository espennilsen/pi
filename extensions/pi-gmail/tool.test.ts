import test from "node:test";
import assert from "node:assert/strict";
import { registerGmailTool } from "./tool.ts";

test("readOnly blocks send actions before confirmation or Gmail API access", async () => {
	let execute: ((...args: any[]) => Promise<any>) | undefined;
	const pi = {
		registerTool(tool: { execute: (...args: any[]) => Promise<any> }) {
			execute = tool.execute;
		},
	} as any;
	registerGmailTool(pi, () => ({ readOnly: true }), {
		getAgentDir: () => "/unused",
		isAuthenticated: () => true,
	});
	assert.ok(execute);

	for (const action of ["send", "send_draft"]) {
		const result = await execute!("call", { action }, new AbortController().signal, () => {}, {
			ui: { confirm: () => { throw new Error("confirmation must not be requested"); } },
		});
		assert.equal(result.content[0].text, "❌ Sending email is disabled because pi-gmail is in read-only mode.");
	}
});
