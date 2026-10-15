import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import gmail from "./index.ts";
import { mountGmailRoutes, updateGmailWebInfo } from "./web.ts";

/** Read the consent callback without opening a browser or contacting Google. */
async function redirectUri(handler: any): Promise<string | null> {
	let location = "";
	await handler({ method: "GET", url: "/gmail/auth" }, {
		writeHead(status: number, headers: Record<string, string>) { assert.equal(status, 302); location = headers.Location; }, end() {},
	}, "/auth");
	return new URL(location).searchParams.get("redirect_uri");
}

for (const serverFirst of [true, false]) {
	test(`mount/remount discovers custom listener with ${serverFirst ? "webserver" : "Gmail"} starting first`, async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "gmail-discovery-"));
		const oldDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		t.after(() => {
			if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = oldDir;
			rmSync(dir, { recursive: true, force: true });
		});
		t.mock.method(SettingsManager, "create", () => ({ getGlobalSettings: () => ({ "pi-gmail": { clientId: "test-client" } }), getProjectSettings: () => ({}) }));
		updateGmailWebInfo({ port: 3100, url: "http://localhost:3100" });
		let info: unknown = serverFirst ? { port: 42873, url: "http://192.0.2.10:42873" } : undefined;
		let handler: any;
		let discoveries = 0;
		const listeners = new Map<string, (data: any) => void>();
		const lifecycle: Record<string, any> = {};
		const bus = {
			on(event: string, fn: (data: any) => void) { listeners.set(event, fn); },
			emit(event: string, data: any) {
				if (event === "web:info") { discoveries++; if (info !== undefined) data.reply(info); }
				if (event === "web:mount") handler = data.handler;
				listeners.get(event)?.(data);
			},
		};
		gmail({ events: bus, on(name: string, fn: any) { lifecycle[name] = fn; }, registerTool() {}, registerCommand() {} } as any);
		t.after(() => lifecycle.session_shutdown());
		await lifecycle.session_start({}, { cwd: dir, ui: { setStatus() {} } });
		assert.equal(discoveries, 1);
		if (!serverFirst) {
			assert.equal(await redirectUri(handler), "http://localhost:3100/gmail/callback");
			info = { port: 42873, url: "http://192.0.2.10:42873" };
			const beforeRemount = discoveries;
			bus.emit("web:ready", {});
			assert.equal(discoveries, beforeRemount + 1);
		}
		assert.equal(await redirectUri(handler), "http://192.0.2.10:42873/gmail/callback");
		info = { port: 42901, url: "http://[::1]:42901" };
		bus.emit("web:ready", {});
		assert.equal(await redirectUri(handler), "http://[::1]:42901/gmail/callback");
	});
}

test("direct auth discovers a listener that becomes ready after mounting", async () => {
	updateGmailWebInfo({ port: 3100, url: "http://localhost:3100" });
	let handler: any;
	let listening = false;
	mountGmailRoutes({ on() {}, emit(event, data: any) {
		if (event === "web:info" && listening) data.reply({ port: 42902, url: "http://127.0.0.1:42902" });
		if (event === "web:mount") handler = data.handler;
	} }, { clientId: "test-client" }, "/unused");
	// web:ready may be emitted before asynchronous server.listen completes.
	listening = true;
	assert.equal(await redirectUri(handler), "http://127.0.0.1:42902/gmail/callback");
});

for (const reply of [undefined, null, {}, { port: "4100", url: "http://bad:4100" }, { port: 4100, url: 42 }, { port: NaN, url: "http://bad:4100" }, { port: 0, url: "http://bad:4100" }, { port: 4100, url: "not a URL" }, { port: 4100, url: "file:///tmp/test" }]) {
	test(`mount ignores absent or malformed discovery reply ${JSON.stringify(reply)}`, async () => {
		updateGmailWebInfo({ port: 42873, url: "http://127.0.0.1:42873" });
		let handler: any;
		let discoveries = 0;
		mountGmailRoutes({ on() {}, emit(event, data: any) {
			if (event === "web:info") { discoveries++; if (reply !== undefined) data.reply(reply); }
			if (event === "web:mount") handler = data.handler;
		} }, { clientId: "test-client" }, "/unused");
		assert.equal(discoveries, 1);
		assert.equal(await redirectUri(handler), "http://127.0.0.1:42873/gmail/callback");
	});
}
