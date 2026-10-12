import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import webserver from "./index.ts";
import { getUrl, isRunning, stop } from "./server.ts";

/** Reserve an available test port without using the live Pi listener. */
async function freePort(): Promise<number> {
	const probe = createServer();
	await new Promise<void>((resolve) => probe.listen(0, "::1", resolve));
	const port = (probe.address() as { port: number }).port;
	await new Promise<void>((resolve, reject) => probe.close((err) => err ? reject(err) : resolve()));
	return port;
}

test("manual and event-bus start/restart honor configured host", async (t) => {
	t.mock.method(SettingsManager, "create", () => ({
		getGlobalSettings: () => ({ "pi-webserver": { host: "::1" } }), getProjectSettings: () => ({}),
	}));
	const events: Record<string, any> = {};
	const lifecycle: Record<string, any> = {};
	let command: any;
	webserver({ events: { on(name: string, fn: any) { events[name] = fn; }, emit() {} },
		on(name: string, fn: any) { lifecycle[name] = fn; }, registerCommand(_name: string, config: any) { command = config.handler; }, sendMessage() {},
	} as any);
	t.after(() => stop());
	const ctx = { cwd: "/unused", ui: { notify() {} } };
	await lifecycle.session_start({}, ctx);
	for (const eventBus of [false, true]) {
		for (const restart of [false, true]) {
			const port = await freePort();
			const args = `${restart ? "port " : ""}${port}`;
			if (eventBus) events["command:web"]({ args });
			else await command(args, ctx);
			for (let i = 0; i < 20 && !isRunning(); i++) await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(getUrl(), `http://[::1]:${port}`);
			stop();
		}
	}
});
