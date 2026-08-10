import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPort, getUrl, isRunning, start, stop } from "./server.ts";
import { registerWebInfoListener, type WebInfo } from "./web-info.ts";

class FakeEvents {
	private handler: ((request: unknown) => void) | undefined;

	on(event: "web:info", handler: (request: unknown) => void): void {
		assert.equal(event, "web:info");
		this.handler = handler;
	}

	emit(request: unknown): void {
		this.handler?.(request);
	}
}

describe("registerWebInfoListener", () => {
	it("replies synchronously with the running server address", () => {
		const events = new FakeEvents();
		const expected = { port: 3100, url: "http://localhost:3100" };
		registerWebInfoListener(events, () => expected);

		let reply: WebInfo | undefined;
		events.emit({ reply: (info: WebInfo) => { reply = info; } });
		assert.deepEqual(reply, expected);
	});

	it("does not reply when no server is listening", () => {
		const events = new FakeEvents();
		registerWebInfoListener(events, () => null);

		let replied = false;
		events.emit({ reply: () => { replied = true; } });
		assert.equal(replied, false);
	});

	it("replies with the dynamic port and URL from the listening server", async () => {
		const events = new FakeEvents();
		registerWebInfoListener(events, () => {
			const port = getPort();
			const url = getUrl();
			return port !== null && url !== null ? { port, url } : null;
		});

		try {
			start(0);
			for (let attempt = 0; attempt < 20 && !isRunning(); attempt++) {
				await new Promise<void>((resolve) => setImmediate(resolve));
			}

			let reply: WebInfo | undefined;
			events.emit({ reply: (info: WebInfo) => { reply = info; } });

			assert.ok(reply);
			const info = reply as WebInfo;
			assert.ok(info.port > 0);
			assert.equal(info.port, getPort());
			assert.equal(info.url, getUrl());
			assert.equal(info.url, `http://localhost:${info.port}`);
		} finally {
			stop();
		}
	});
});
