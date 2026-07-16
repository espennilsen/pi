import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpawnOptions } from "node:child_process";
import { getBrowserCommand, openUrl } from "./utils.ts";

describe("getBrowserCommand", () => {
	const url = "https://accounts.google.com/o/oauth2/auth?x=1&y=2";

	it("uses shell-free platform launchers", () => {
		assert.deepEqual(getBrowserCommand(url, "darwin"), {
			command: "open",
			args: [url],
		});
		assert.deepEqual(getBrowserCommand(url, "win32"), {
			command: "rundll32",
			args: ["url.dll,FileProtocolHandler", url],
		});
		assert.deepEqual(getBrowserCommand(url, "linux"), {
			command: "xdg-open",
			args: [url],
		});
	});
});

describe("openUrl", () => {
	it("detaches the launcher, ignores stdio, and handles async errors", () => {
		let errorHandler: (() => void) | undefined;
		let unrefCalled = false;
		let observed: { command: string; args: string[]; options: SpawnOptions } | undefined;
		const fakeSpawn = (command: string, args: string[], options: SpawnOptions) => {
			observed = { command, args, options };
			return {
				once(event: "error", handler: (error: Error) => void) {
					assert.equal(event, "error");
					errorHandler = () => handler(new Error("ENOENT"));
					return this;
				},
				unref() {
					unrefCalled = true;
					return this;
				},
			};
		};

		openUrl("https://example.com/?a=1&b=2", "win32", fakeSpawn);
		assert.deepEqual(observed, {
			command: "rundll32",
			args: ["url.dll,FileProtocolHandler", "https://example.com/?a=1&b=2"],
			options: { detached: true, stdio: "ignore", shell: false },
		});
		assert.equal(unrefCalled, true);
		assert.doesNotThrow(() => errorHandler?.());
	});

	it("does not throw when the launcher is missing", () => {
		assert.doesNotThrow(() => {
			openUrl("https://example.com", "linux", () => {
				throw new Error("ENOENT");
			});
		});
	});
});
