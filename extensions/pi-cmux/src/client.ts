/**
 * pi-cmux — Unix socket JSON-RPC client for cmux.
 *
 * Communicates with cmux via its Unix domain socket at /tmp/cmux.sock.
 * Protocol: newline-terminated JSON-RPC over Unix socket.
 *
 * Request:  {"id":"<uuid>","method":"<method>","params":{...}}\n
 * Response: {"id":"<uuid>","ok":true,"result":{...}}\n
 *       or: {"id":"<uuid>","ok":false,"error":"message"}\n
 */

import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { LogFn } from "./logger.ts";

/** Default cmux socket path. */
const DEFAULT_SOCKET = "/tmp/cmux.sock";

/** Timeout for individual RPC calls (ms). */
const RPC_TIMEOUT_MS = 10_000;

/** Connection timeout (ms). */
const CONNECT_TIMEOUT_MS = 3_000;

export interface CmuxClientOptions {
	socketPath?: string;
	log: LogFn;
}

export interface CmuxRpcResult {
	ok: boolean;
	result?: unknown;
	error?: string;
}

export class CmuxClient {
	readonly socketPath: string;
	private log: LogFn;

	constructor(options: CmuxClientOptions) {
		this.socketPath = options.socketPath ?? process.env.CMUX_SOCKET_PATH ?? DEFAULT_SOCKET;
		this.log = options.log;
	}

	/** Check if the cmux socket exists. */
	isAvailable(): boolean {
		return existsSync(this.socketPath);
	}

	/** Send an RPC request to cmux and return the result. */
	async rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
		const id = randomUUID();

		return new Promise((resolve, reject) => {
			let settled = false;
			const settle = (fn: () => void) => {
				if (!settled) {
					settled = true;
					fn();
				}
			};

			const timeout = setTimeout(() => {
				settle(() => {
					conn.destroy();
					const err = new Error(`cmux RPC timeout (${RPC_TIMEOUT_MS}ms): ${method}`);
					this.log("rpc_timeout", { method, id }, "WARN");
					reject(err);
				});
			}, RPC_TIMEOUT_MS);

			const conn: Socket = createConnection({ path: this.socketPath });

			conn.setTimeout(CONNECT_TIMEOUT_MS);

			conn.on("timeout", () => {
				settle(() => {
					clearTimeout(timeout);
					conn.destroy();
					const err = new Error(`cmux connect timeout: ${method}`);
					this.log("connect_timeout", { method, id }, "WARN");
					reject(err);
				});
			});

			conn.on("error", (err) => {
				settle(() => {
					clearTimeout(timeout);
					this.log("rpc_error", { method, id, error: err.message }, "ERROR");
					reject(err);
				});
			});

			// Accumulate data — response may arrive in multiple chunks
			let buffer = "";
			conn.on("data", (chunk: Buffer) => {
				buffer += chunk.toString();
				// cmux responses are newline-terminated
				const newlineIdx = buffer.indexOf("\n");
				if (newlineIdx === -1) return;

				const line = buffer.slice(0, newlineIdx);
				settle(() => {
					clearTimeout(timeout);
					conn.end();
					try {
						const res = JSON.parse(line) as CmuxRpcResult & { id: string };
						if (res.ok) {
							this.log("rpc_ok", { method, id }, "DEBUG");
							resolve(res.result);
						} else {
							const err = new Error(`cmux RPC error (${method}): ${res.error ?? "unknown"}`);
							this.log("rpc_fail", { method, id, error: res.error }, "WARN");
							reject(err);
						}
					} catch (parseErr) {
						const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
						this.log("rpc_parse_error", { method, id, raw: line.slice(0, 200), error: msg }, "ERROR");
						reject(new Error(`cmux RPC parse error: ${msg}`));
					}
				});
			});

			conn.on("connect", () => {
				const payload = JSON.stringify({ id, method, params }) + "\n";
				conn.write(payload);
				this.log("rpc_sent", { method, id }, "DEBUG");
			});
		});
	}

	// ── Convenience methods ─────────────────────────────────────

	/** Send a desktop notification. */
	async notify(title: string, body: string, subtitle?: string): Promise<void> {
		const params: Record<string, unknown> = { title, body };
		if (subtitle) params.subtitle = subtitle;
		await this.rpc("notify", params);
	}

	/** Set sidebar status text. */
	async setStatus(label: string): Promise<void> {
		await this.rpc("status.set", { label });
	}

	/** Clear sidebar status. */
	async clearStatus(): Promise<void> {
		await this.rpc("status.clear", {});
	}

	/** Set progress bar (0.0–1.0). */
	async setProgress(value: number, label?: string): Promise<void> {
		const params: Record<string, unknown> = { value };
		if (label) params.label = label;
		await this.rpc("progress.set", params);
	}

	/** Clear progress bar. */
	async clearProgress(): Promise<void> {
		await this.rpc("progress.clear", {});
	}

	/** Read terminal screen output from a surface. */
	async readScreen(surface: string, lines?: number): Promise<string> {
		const params: Record<string, unknown> = { surface };
		if (lines !== undefined) params.lines = lines;
		const result = await this.rpc("screen.read", params);
		return typeof result === "string" ? result : JSON.stringify(result);
	}

	/** List all surfaces. */
	async listSurfaces(): Promise<unknown[]> {
		const result = await this.rpc("surface.list", {});
		return Array.isArray(result) ? result : (result as { surfaces?: unknown[] })?.surfaces ?? [];
	}

	/** Split a surface in a direction. */
	async splitSurface(direction: "right" | "down"): Promise<unknown> {
		return await this.rpc("surface.split", { direction });
	}

	/** Focus a surface. */
	async focusSurface(surface: string): Promise<void> {
		await this.rpc("surface.focus", { surface });
	}

	/** Close a surface. */
	async closeSurface(surface: string): Promise<void> {
		await this.rpc("surface.close", { surface });
	}

	/** Send text input to a surface. */
	async sendInput(surface: string, text: string): Promise<void> {
		await this.rpc("input.send", { surface, text });
	}

	/** Send a keystroke to a surface. */
	async sendKey(surface: string, key: string): Promise<void> {
		await this.rpc("input.send_key", { surface, key });
	}

	/** List workspaces. */
	async listWorkspaces(): Promise<unknown[]> {
		const result = await this.rpc("workspace.list", {});
		return Array.isArray(result) ? result : (result as { workspaces?: unknown[] })?.workspaces ?? [];
	}

	/** Rename current workspace. */
	async renameWorkspace(name: string): Promise<void> {
		await this.rpc("workspace.rename", { name });
	}

	// ── Browser automation ──────────────────────────────────────

	/** Open a URL in cmux's built-in browser. */
	async browserOpen(url: string): Promise<unknown> {
		return await this.rpc("browser.open", { url });
	}

	/** Navigate an existing browser surface to a URL. */
	async browserNavigate(surface: string, url: string): Promise<void> {
		await this.rpc("browser.navigate", { surface, url });
	}

	/** Get a DOM snapshot of a browser surface. */
	async browserSnapshot(surface: string, compact?: boolean): Promise<string> {
		const params: Record<string, unknown> = { surface };
		if (compact !== undefined) params.compact = compact;
		const result = await this.rpc("browser.snapshot", params);
		return typeof result === "string" ? result : JSON.stringify(result);
	}

	/** Take a screenshot of a browser surface. */
	async browserScreenshot(surface: string): Promise<unknown> {
		return await this.rpc("browser.screenshot", { surface });
	}

	/** Click an element in a browser surface. */
	async browserClick(surface: string, selector: string): Promise<void> {
		await this.rpc("browser.click", { surface, selector });
	}

	/** Fill a form field in a browser surface. */
	async browserFill(surface: string, selector: string, value: string): Promise<void> {
		await this.rpc("browser.fill", { surface, selector, value });
	}

	/** Evaluate JavaScript in a browser surface. */
	async browserEval(surface: string, expression: string): Promise<unknown> {
		return await this.rpc("browser.eval", { surface, expression });
	}
}
