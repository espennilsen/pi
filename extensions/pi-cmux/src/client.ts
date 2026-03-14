/**
 * pi-cmux — Unix socket client for cmux.
 *
 * Communicates with cmux via its Unix domain socket at /tmp/cmux.sock.
 *
 * Two protocols are used:
 *
 * 1. JSON-RPC — for workspace, surface, notification, browser, and system commands.
 *    Request:  {"id":"<uuid>","method":"<method>","params":{...}}\n
 *    Response: {"id":"<uuid>","ok":true,"result":{...}}\n
 *         or: {"id":"<uuid>","ok":false,"error":"message"}\n
 *
 * 2. Text-based — for sidebar metadata (status pills, progress bars, logs).
 *    Request:  set_status <key> <value> --tab=<workspace-uuid>\n
 *    Response: OK\n
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

	/** Send a JSON-RPC request to cmux and return the result. */
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
							const errMsg = typeof res.error === "string"
								? res.error
								: res.error != null
									? JSON.stringify(res.error)
									: "unknown";
							const err = new Error(`cmux RPC error (${method}): ${errMsg}`);
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

			conn.on("close", () => {
				settle(() => {
					clearTimeout(timeout);
					reject(new Error(`cmux socket closed before response (${method})`));
				});
			});

			conn.on("connect", () => {
				conn.setTimeout(0); // disable idle timer — only guard the connect phase
				const payload = JSON.stringify({ id, method, params }) + "\n";
				conn.write(payload);
				this.log("rpc_sent", { method, id }, "DEBUG");
			});
		});
	}

	/**
	 * Send a text-based command to the cmux socket.
	 *
	 * Sidebar metadata commands (status, progress, log) use a text-based
	 * protocol instead of JSON-RPC. The format is:
	 *   command [args...] --tab=<workspace-uuid>\n
	 * Response is a plain text line (e.g. "OK\n").
	 */
	async textCmd(command: string): Promise<string> {
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
					const err = new Error(`cmux text command timeout (${RPC_TIMEOUT_MS}ms): ${command}`);
					this.log("text_timeout", { command }, "WARN");
					reject(err);
				});
			}, RPC_TIMEOUT_MS);

			const conn: Socket = createConnection({ path: this.socketPath });

			conn.setTimeout(CONNECT_TIMEOUT_MS);

			conn.on("timeout", () => {
				settle(() => {
					clearTimeout(timeout);
					conn.destroy();
					const err = new Error(`cmux connect timeout (text): ${command}`);
					this.log("text_connect_timeout", { command }, "WARN");
					reject(err);
				});
			});

			conn.on("error", (err) => {
				settle(() => {
					clearTimeout(timeout);
					this.log("text_error", { command, error: err.message }, "ERROR");
					reject(err);
				});
			});

			let buffer = "";
			conn.on("data", (chunk: Buffer) => {
				buffer += chunk.toString();
				const newlineIdx = buffer.indexOf("\n");
				if (newlineIdx === -1) return;

				const line = buffer.slice(0, newlineIdx).trim();
				settle(() => {
					clearTimeout(timeout);
					conn.end();
					this.log("text_ok", { command, response: line }, "DEBUG");
					resolve(line);
				});
			});

			conn.on("close", () => {
				settle(() => {
					clearTimeout(timeout);
					// If we got some data before close, treat it as the response
					if (buffer.trim()) {
						resolve(buffer.trim());
					} else {
						reject(new Error(`cmux socket closed before response (text): ${command}`));
					}
				});
			});

			conn.on("connect", () => {
				conn.setTimeout(0);
				conn.write(command + "\n");
				this.log("text_sent", { command }, "DEBUG");
			});
		});
	}

	// ── Notifications (JSON-RPC) ────────────────────────────────

	/** Send a desktop notification. */
	async notify(title: string, body: string, subtitle?: string): Promise<void> {
		const params: Record<string, unknown> = { title, body };
		if (subtitle) params.subtitle = subtitle;
		await this.rpc("notification.create", params);
	}

	// ── Sidebar metadata (text-based protocol) ──────────────────

	/**
	 * Quote a value for the text-based sidebar protocol.
	 * Strips CR/LF (which would split into multiple socket messages)
	 * and wraps in single quotes if the value contains spaces or quotes.
	 */
	private q(s: string): string {
		// Strip newlines — they'd split the command on the wire
		const clean = s.replace(/[\r\n]/g, " ");
		// If it contains spaces or single quotes, shell-quote it
		if (/[\s']/.test(clean)) {
			return `'${clean.replace(/'/g, "'\\''")}'`;
		}
		return clean;
	}

	/**
	 * Set a sidebar status pill.
	 * Uses a unique key so different tools can manage their own entries.
	 */
	async setStatus(key: string, value: string, options?: { icon?: string; color?: string }): Promise<void> {
		const workspaceId = process.env.CMUX_WORKSPACE_ID;
		if (!workspaceId) return;
		let cmd = `set_status ${this.q(key)} ${this.q(value)}`;
		if (options?.icon) cmd += ` --icon=${this.q(options.icon)}`;
		if (options?.color) cmd += ` --color=${this.q(options.color)}`;
		cmd += ` --tab=${workspaceId}`;
		await this.textCmd(cmd);
	}

	/** Remove a sidebar status entry by key. */
	async clearStatus(key: string): Promise<void> {
		const workspaceId = process.env.CMUX_WORKSPACE_ID;
		if (!workspaceId) return;
		await this.textCmd(`clear_status ${this.q(key)} --tab=${workspaceId}`);
	}

	/** Set progress bar (0.0–1.0) in the sidebar. */
	async setProgress(value: number, label?: string): Promise<void> {
		const workspaceId = process.env.CMUX_WORKSPACE_ID;
		if (!workspaceId) return;
		let cmd = `set_progress ${value}`;
		if (label) cmd += ` --label=${this.q(label)}`;
		cmd += ` --tab=${workspaceId}`;
		await this.textCmd(cmd);
	}

	/** Clear the sidebar progress bar. */
	async clearProgress(): Promise<void> {
		const workspaceId = process.env.CMUX_WORKSPACE_ID;
		if (!workspaceId) return;
		await this.textCmd(`clear_progress --tab=${workspaceId}`);
	}

	/** Append a log entry to the sidebar. */
	async sidebarLog(message: string, options?: { level?: "info" | "progress" | "success" | "warning" | "error"; source?: string }): Promise<void> {
		const workspaceId = process.env.CMUX_WORKSPACE_ID;
		if (!workspaceId) return;
		let cmd = "log";
		if (options?.level) cmd += ` --level=${this.q(options.level)}`;
		if (options?.source) cmd += ` --source=${this.q(options.source)}`;
		cmd += ` --tab=${workspaceId}`;
		cmd += ` -- ${this.q(message)}`;
		await this.textCmd(cmd);
	}

	/** Clear all sidebar log entries. */
	async clearLog(): Promise<void> {
		const workspaceId = process.env.CMUX_WORKSPACE_ID;
		if (!workspaceId) return;
		await this.textCmd(`clear_log --tab=${workspaceId}`);
	}

	// ── Surface management (JSON-RPC) ───────────────────────────

	/** Read terminal screen output from a surface. */
	async readScreen(surfaceId: string, lines?: number): Promise<string> {
		const params: Record<string, unknown> = { surface_id: surfaceId };
		if (lines !== undefined) params.lines = lines;
		const result = await this.rpc("surface.read_text", params);
		if (result != null && typeof result === "object" && "text" in result) {
			return (result as { text: string }).text;
		}
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
	async focusSurface(surfaceId: string): Promise<void> {
		await this.rpc("surface.focus", { surface_id: surfaceId });
	}

	/** Close a surface. */
	async closeSurface(surfaceId: string): Promise<void> {
		await this.rpc("surface.close", { surface_id: surfaceId });
	}

	/** Send text input to a surface. */
	async sendInput(surfaceId: string, text: string): Promise<void> {
		await this.rpc("surface.send_text", { surface_id: surfaceId, text });
	}

	/** Send a keystroke to a surface. */
	async sendKey(surfaceId: string, key: string): Promise<void> {
		await this.rpc("surface.send_key", { surface_id: surfaceId, key });
	}

	// ── Workspace management (JSON-RPC) ─────────────────────────

	/** List workspaces. */
	async listWorkspaces(): Promise<unknown[]> {
		const result = await this.rpc("workspace.list", {});
		return Array.isArray(result) ? result : (result as { workspaces?: unknown[] })?.workspaces ?? [];
	}

	/** Rename a workspace. */
	async renameWorkspace(title: string, workspaceId?: string): Promise<void> {
		const wsId = workspaceId ?? process.env.CMUX_WORKSPACE_ID;
		if (!wsId) return;
		await this.rpc("workspace.rename", { workspace_id: wsId, title });
	}

	// ── Browser automation (JSON-RPC) ───────────────────────────

	/**
	 * Discover browser surfaces in the current workspace.
	 * Queries surface.list and filters by type === "browser".
	 * Returns the most recently added browser surface ID, or undefined.
	 */
	async discoverBrowserSurface(): Promise<string | undefined> {
		const workspaceId = process.env.CMUX_WORKSPACE_ID;
		const params: Record<string, unknown> = {};
		if (workspaceId) params.workspace_id = workspaceId;
		const result = await this.rpc("surface.list", params);
		const surfaces = Array.isArray(result)
			? result
			: (result as { surfaces?: unknown[] })?.surfaces ?? [];
		// Find browser surfaces, return the last one (most recently added)
		const browsers = surfaces.filter(
			(s) => s != null && typeof s === "object" && (s as Record<string, unknown>).type === "browser",
		);
		if (browsers.length === 0) return undefined;
		const last = browsers[browsers.length - 1] as Record<string, unknown>;
		return (last.id ?? last.surface_id ?? last.ref) as string | undefined;
	}

	/** Open a URL in cmux's built-in browser (in the caller's workspace). */
	async browserOpen(url: string): Promise<unknown> {
		const params: Record<string, unknown> = { url };
		const wsId = process.env.CMUX_WORKSPACE_ID;
		if (wsId) params.workspace_id = wsId;
		const surfaceId = process.env.CMUX_SURFACE_ID;
		if (surfaceId) params.surface_id = surfaceId;
		return await this.rpc("browser.open_split", params);
	}

	/** Navigate an existing browser surface to a URL. */
	async browserNavigate(surfaceId: string, url: string): Promise<void> {
		await this.rpc("browser.navigate", { surface_id: surfaceId, url });
	}

	/** Get a DOM snapshot of a browser surface. */
	async browserSnapshot(surfaceId: string, compact?: boolean): Promise<string> {
		const params: Record<string, unknown> = { surface_id: surfaceId };
		if (compact !== undefined) params.compact = compact;
		const result = await this.rpc("browser.snapshot", params);
		return typeof result === "string" ? result : JSON.stringify(result);
	}

	/** Take a screenshot of a browser surface. */
	async browserScreenshot(surfaceId: string): Promise<unknown> {
		return await this.rpc("browser.screenshot", { surface_id: surfaceId });
	}

	/** Click an element in a browser surface. */
	async browserClick(surfaceId: string, selector: string): Promise<void> {
		await this.rpc("browser.click", { surface_id: surfaceId, selector });
	}

	/** Fill a form field in a browser surface. */
	async browserFill(surfaceId: string, selector: string, value: string): Promise<void> {
		await this.rpc("browser.fill", { surface_id: surfaceId, selector, value });
	}

	/** Evaluate JavaScript in a browser surface. */
	async browserEval(surfaceId: string, expression: string): Promise<unknown> {
		return await this.rpc("browser.eval", { surface_id: surfaceId, expression });
	}
}
