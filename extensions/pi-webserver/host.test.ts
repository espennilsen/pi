import assert from "node:assert/strict";
import { test } from "node:test";
import { getPort, getUrl, isRunning, start, stop, setLogger } from "./server.ts";

for (const [host, advertised] of [["127.0.0.1", "127.0.0.1"], ["::1", "[::1]"], ["0.0.0.0", "127.0.0.1"], ["::", "[::1]"]]) {
	test(`host ${host} uses valid, reachable endpoints`, async (t) => {
		const logs: any[] = [];
		setLogger((event, data, level) => logs.push({ event, data, level }));
		t.after(() => { stop(); setLogger(() => {}); });
		const initial = start(0, host);
		for (let i = 0; i < 20 && !isRunning(); i++) await new Promise<void>((resolve) => setImmediate(resolve));
		assert.ok(isRunning());
		assert.equal(initial, `http://${advertised}:0`);
		assert.equal(getUrl(), `http://${advertised}:${getPort()}`);
		const response = await fetch(`${getUrl()}/_api/mounts`);
		assert.equal(response.status, 200);
		assert.ok(Array.isArray(await response.json()));
		assert.equal(logs.some((entry) => entry.level === "WARN" && /HTTP/.test(JSON.stringify(entry.data))), host === "::" || host === "0.0.0.0");
	});
}
