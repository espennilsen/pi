import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getAccessToken, saveTokens } from "./auth.ts";
import { registerGmailTool } from "./tool.ts";
import type { GmailSettings } from "./types.ts";

const settings: GmailSettings = {
	clientId: "global-id", clientSecret: "global-secret", readOnly: false,
	accounts: { work: { readOnly: true } },
};

for (const account of [" work ", "orphan", "toString", "   "]) {
	for (const action of ["send", "send_draft"] as const) {
		test(`${action} rejects invalid account ${JSON.stringify(account)} before reading tokens`, async (t) => {
			let execute: any;
			registerGmailTool({ registerTool(tool: any) { execute = tool.execute; } } as any, () => settings, {
				getAgentDir: () => "/unused",
				isAuthenticated: () => { throw new Error("token lookup must not occur"); },
			});
			t.mock.method(globalThis, "fetch", () => { throw new Error("network access must not occur"); });
			await assert.rejects(() => execute("call", { action, account, to: "recipient@example.test", subject: "test", body: "test", draft_id: "draft" }, undefined, undefined, {
				ui: { confirm() { throw new Error("confirmation must not occur"); } },
			}), /Invalid account name|not configured/);
		});
	}
}

for (const selection of ["explicit", "active", "default"] as const) {
	test(`read-only policy follows a valid ${selection} account selection`, async () => {
		let execute: any;
		const selected = { ...settings, account: selection === "active" ? "work" : undefined, defaultAccount: selection === "default" ? "work" : undefined };
		registerGmailTool({ registerTool(tool: any) { execute = tool.execute; } } as any, () => selected, {
			getAgentDir: () => "/unused",
			isAuthenticated: (_dir, account) => { assert.equal(account, "work"); return true; },
		});
		for (const action of ["send", "send_draft"]) {
			const result = await execute("call", { action, account: selection === "explicit" ? "work" : undefined }, undefined, undefined, {
				ui: { confirm() { throw new Error("confirmation must not occur"); } },
			});
			assert.match(result.content[0].text, /disabled.*read-only/);
		}
	});
}

for (const account of [" work ", "orphan", "toString", "   "]) {
	test(`fresh tokens do not bypass validation for ${JSON.stringify(account)}`, async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "gmail-policy-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		saveTokens(dir, { email: "protected@example.test", access_token: "fresh", refresh_token: "refresh", expires_at: Date.now() + 3600000, scope: "" }, account);
		t.mock.method(globalThis, "fetch", () => { throw new Error("network access must not occur"); });
		await assert.rejects(getAccessToken(settings, dir, account), /Invalid account name|not configured/);
		await assert.rejects(getAccessToken({ ...settings, account }, dir), /Invalid account name|not configured/);
	});
}

test("explicit default keeps global policy when a protected named account is active", async () => {
	let execute: any;
	registerGmailTool({ registerTool(tool: any) { execute = tool.execute; } } as any, () => ({ ...settings, account: "work" }), {
		getAgentDir: () => "/unused",
		isAuthenticated: (_dir, account) => { assert.equal(account, "default"); return true; },
	});
	// Required-argument validation proves this selection did not inherit work's send prohibition.
	const result = await execute("call", { action: "send", account: "default" }, undefined, undefined, {});
	assert.match(result.content[0].text, /Missing required field: to/);
});
