import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import gmail, { resolveAccountTarget } from "./index.ts";
import { exchangeCode, getAccessToken, getConsentUrl, loadTokens, saveTokens, verifyOAuthState } from "./auth.ts";
import { mountGmailRoutes } from "./web.ts";

const settings = {
	clientId: "global-id", clientSecret: "global-secret", account: "work",
	accounts: { work: { clientId: "work-id", clientSecret: "work-secret" } },
};

test("explicit default survives command normalization, consent, state and token exchange", async (t) => {
	assert.equal(resolveAccountTarget("default"), "default");
	const dir = mkdtempSync(join(tmpdir(), "gmail-oauth-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const consent = new URL(getConsentUrl(settings, "http://localhost/callback", "default"));
	assert.equal(consent.searchParams.get("client_id"), "global-id");
	const state = verifyOAuthState(consent.searchParams.get("state"));
	assert.deepEqual(state, { valid: true, account: "default" });
	t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
		if (url.includes("/token")) {
			assert.equal((init?.body as URLSearchParams).get("client_id"), "global-id");
			assert.equal((init?.body as URLSearchParams).get("client_secret"), "global-secret");
			assert.ok(init?.signal);
			return Response.json({ access_token: "default-token", refresh_token: "refresh" });
		}
		return Response.json({ emailAddress: "default@example.test" });
	});
	await exchangeCode(settings, "code", "http://localhost/callback", dir, state.account);
	assert.equal(loadTokens(dir, "default")?.access_token, "default-token");
	assert.equal(loadTokens(dir, "work"), null);
});

test("implicit consent captures active account before settings change", () => {
	const consent = new URL(getConsentUrl(settings, "http://localhost/callback"));
	assert.equal(verifyOAuthState(consent.searchParams.get("state")).account, "work");
});

test("web auth keeps explicit default separate from active work", async () => {
	let handler: any;
	mountGmailRoutes({ on() {}, emit(event, data: any) {
		if (event === "web:mount") handler = data.handler;
	} }, settings, "/unused");
	let location = "";
	await handler({ method: "GET", url: "/gmail/auth?account=default" }, {
		writeHead(status: number, headers: any) { assert.equal(status, 302); location = headers.Location; }, end() {},
	}, "/auth");
	const consent = new URL(location);
	assert.equal(consent.searchParams.get("client_id"), "global-id");
	assert.equal(verifyOAuthState(consent.searchParams.get("state")).account, "default");
});

test("defaultAccount uses the same named token file for API access", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "gmail-default-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	saveTokens(dir, { email: "work@example.test", access_token: "work-token", refresh_token: "refresh", expires_at: Date.now() + 3600000, scope: "" }, "work");
	assert.equal(await getAccessToken({ ...settings, account: undefined, defaultAccount: "work" }, dir), "work-token");
});

for (const failure of ["none", "page", "metadata"] as const) {
	test(`notification polling drains pages and retries ${failure} failures`, async (t) => {
		let now = 100_000;
		t.mock.method(Date, "now", () => now);
		const dir = mkdtempSync(join(tmpdir(), "gmail-poll-"));
		const oldDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		t.after(() => {
			if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = oldDir;
			rmSync(dir, { recursive: true, force: true });
		});
		t.mock.method(SettingsManager, "create", () => ({
			getGlobalSettings: () => ({ "pi-gmail": { ...settings, notifications: { enabled: true, channel: "ops" } } }),
			getProjectSettings: () => ({}),
		}));
		saveTokens(dir, { email: "work@example.test", access_token: "work-token", refresh_token: "refresh", expires_at: Date.now() + 3600000, scope: "" }, "work");
		const lifecycle: Record<string, any> = {};
		const commands: Record<string, any> = {};
		const errors: string[] = [];
		const sent: any[] = [];
		const scheduled: Array<() => Promise<void>> = [];
		t.mock.method(globalThis, "setTimeout", (fn: any) => { scheduled.push(fn); return scheduled.length as any; });
		t.mock.method(globalThis, "clearTimeout", () => {});
		let fail = failure !== "none";
		const queries: string[] = [];
		t.mock.method(globalThis, "fetch", async (input: string) => {
			const url = new URL(input);
			if (url.pathname.endsWith("/messages")) {
				queries.push(url.searchParams.get("q")!);
				if (url.searchParams.get("pageToken") === "next") {
					if (fail && failure === "page") throw new Error("page failure");
					return Response.json({ messages: [{ id: "last", threadId: "last" }] });
				}
				return Response.json({ messages: Array.from({ length: 20 }, (_, i) => ({ id: `${failure}-${i}`, threadId: `${i}` })), nextPageToken: "next" });
			}
			if (fail && failure === "metadata") throw new Error("metadata failure");
			return Response.json({ id: url.pathname.split("/").pop(), payload: { headers: [] }, snippet: "hello" });
		});
		gmail({ on(name: string, fn: any) { lifecycle[name] = fn; }, registerTool() {}, registerCommand(name: string, command: any) { commands[name] = command.handler; },
			events: { on() {}, emit(name: string, data: any) { if (name === "channel:send") sent.push(data); } },
		} as any);
		t.after(() => lifecycle.session_shutdown());
		const ctx = { cwd: dir, ui: { setStatus() {}, notify(message: string) { errors.push(message); } } };
		await lifecycle.session_start({}, ctx);
		now += 10_000;
		await scheduled.shift()!();
		if (failure !== "none") {
			assert.equal(sent.length, 0);
			fail = false;
			now += 10_000;
			await scheduled.shift()!();
			assert.equal(queries[0], queries.at(-1), "failed poll retains its query window");
		}
		assert.equal(sent.length, 1);
		assert.equal(sent[0].adapter, "ops");
		assert.equal(sent[0].recipient, "");
		assert.match(sent[0].text, /21 new emails/);
		assert.ok(queries.length >= 2);
		const completedAt = now;
		now += 10_000;
		await scheduled.shift()!();
		assert.match(queries.at(-1)!, new RegExp(`after:${completedAt / 1000}$`));
		assert.equal(sent.length, 1, "already-counted messages are not re-notified");
		// A token file alone cannot supply missing per-account OAuth credentials.
		saveTokens(dir, loadTokens(dir, "work")!, "orphan");
		await assert.doesNotReject(() => commands["gmail-switch"]("orphan", ctx));
		assert.match(errors.at(-1)!, /not configured/);
	});
}
