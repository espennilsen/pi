import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { clearTokens, getAuthenticatedEmail, getTokensPath, isAuthenticated, loadTokens, saveTokens } from "./auth.ts";
import type { OAuthTokens } from "./types.ts";

const tokens: OAuthTokens = { email: "work@example.test", access_token: "work-token", refresh_token: "refresh", expires_at: 1234, scope: "" };
const operations = {
	path: (dir: string, name: string) => getTokensPath(dir, name),
	read: (dir: string, name: string) => loadTokens(dir, name),
	write: (dir: string, name: string) => saveTokens(dir, { ...tokens, access_token: "overwrite" }, name),
	delete: (dir: string, name: string) => clearTokens(dir, name),
	status: (dir: string, name: string) => isAuthenticated(dir, name),
	email: (dir: string, name: string) => getAuthenticatedEmail(dir, name),
};

for (const name of [" work ", " default ", " \t "]) {
	for (const [operation, invoke] of Object.entries(operations)) {
		test(`direct token ${operation} rejects ${JSON.stringify(name)} without side effects`, async (t) => {
			const dir = mkdtempSync(join(tmpdir(), "gmail-token-identity-"));
			t.after(() => rmSync(dir, { recursive: true, force: true }));
			saveTokens(dir, tokens, "work");
			saveTokens(dir, { ...tokens, access_token: "default-token" });
			let requests = 0;
			t.mock.method(globalThis, "fetch", async () => { requests++; return new Response(null, { status: 200 }); });
			await assert.rejects(async () => invoke(dir, name), /Invalid account name/);
			assert.equal(requests, 0, "invalid deletion must not revoke another account");
			assert.deepEqual(loadTokens(dir, "work"), tokens);
			assert.equal(loadTokens(dir)?.access_token, "default-token");
		});
	}
}

test("valid default aliases and named accounts retain isolated read/write/delete behavior", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "gmail-token-valid-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));
	for (const name of [undefined, "default", ""]) {
		assert.equal(getTokensPath(dir, name), join(dir, "db", "gmail-tokens.json"));
		saveTokens(dir, tokens, name);
		assert.deepEqual(loadTokens(dir, "default"), tokens);
		assert.equal(isAuthenticated(dir, name), true);
		assert.equal(getAuthenticatedEmail(dir, name), tokens.email);
		await clearTokens(dir, name);
		assert.equal(loadTokens(dir, "default"), null);
	}
	saveTokens(dir, tokens, "work");
	saveTokens(dir, { ...tokens, access_token: "default-token" });
	await clearTokens(dir, "work");
	assert.equal(loadTokens(dir, "work"), null);
	assert.equal(loadTokens(dir)?.access_token, "default-token");
});
