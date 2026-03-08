/**
 * pi-a2a — Standalone HTTP server.
 *
 * Self-contained A2A protocol server — no dependency on pi-webserver
 * or any other extensions.
 *
 * Routes:
 *   GET  /.well-known/agent.json  — A2A Agent Card
 *   POST /                        — A2A JSON-RPC 2.0 endpoint
 *   GET  /health                  — Health check
 */

import * as http from "node:http";
import type { AgentCard } from "./types.ts";
import { handleJsonRpc } from "./rpc-handler.ts";
import type { LogFn } from "./logger.ts";

const MAX_BODY = 1_048_576; // 1 MB

export interface ServerOptions {
	port: number;
	/** Bind address. Defaults to "127.0.0.1" (localhost only). */
	bind?: string;
	/** API key for authenticating RPC requests. When set, POST / requires
	 *  Authorization: Bearer <apiKey>. */
	apiKey?: string;
	agentCard: AgentCard;
	cwd: string;
	log: LogFn;
}

let server: http.Server | null = null;

export function startServer(opts: ServerOptions): Promise<void> {
	return new Promise((resolve, reject) => {
		if (server) {
			opts.log("server_already_running", { port: opts.port }, "WARN");
			resolve();
			return;
		}

		const isLocalhost = !opts.bind || opts.bind === "127.0.0.1" || opts.bind === "::1";
		const corsOrigin = isLocalhost ? "*" : (opts.apiKey ? "*" : "");
		const corsHeaders = opts.apiKey ? "Content-Type, Authorization" : "Content-Type";

		server = http.createServer(async (req, res) => {
			const method = req.method ?? "GET";
			const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
			const pathname = url.pathname;

			// CORS headers
			if (corsOrigin) {
				res.setHeader("Access-Control-Allow-Origin", corsOrigin);
			}
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", corsHeaders);

			if (method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}

			try {
				// GET /.well-known/agent.json — Agent Card
				if (pathname === "/.well-known/agent.json" && method === "GET") {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(opts.agentCard, null, 2));
					return;
				}

				// GET /health — Health check
				if (pathname === "/health" && method === "GET") {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ status: "healthy", agent: opts.agentCard.name }));
					return;
				}

				// POST / — A2A JSON-RPC 2.0
				if (pathname === "/" && method === "POST") {
					// API key auth when configured
					if (opts.apiKey) {
						const authHeader = req.headers.authorization ?? "";
						const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
						if (token !== opts.apiKey) {
							res.writeHead(401, { "Content-Type": "application/json" });
							res.end(JSON.stringify({ error: "Unauthorized" }));
							return;
						}
					}

					const body = await readBody(req);
					const result = await handleJsonRpc(body, opts.cwd, opts.log);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(result));
					return;
				}

				// 404
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Not found" }));
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				opts.log("server_error", { path: pathname, error: msg }, "ERROR");
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Internal server error" }));
			}
		});

		server.on("error", (err) => {
			opts.log("server_bind_error", { error: err.message }, "ERROR");
			server = null;
			reject(err);
		});

		const bind = opts.bind ?? "127.0.0.1";
		const logHost = (bind && bind !== "0.0.0.0") ? bind : "localhost";
		server.listen(opts.port, bind, () => {
			opts.log("server_started", { port: opts.port, bind, agentCard: `http://${logHost}:${opts.port}/.well-known/agent.json` });
			resolve();
		});
	});
}

export function stopServer(log: LogFn): Promise<void> {
	return new Promise((resolve) => {
		if (!server) {
			resolve();
			return;
		}
		server.close(() => {
			log("server_stopped");
			server = null;
			resolve();
		});
	});
}

export function isRunning(): boolean {
	return server !== null;
}

// ── Helpers ─────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		let rejected = false;

		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
			if (body.length > MAX_BODY) {
				rejected = true;
				req.destroy();
				reject(new Error("Payload too large"));
			}
		});

		req.on("end", () => {
			if (!rejected) resolve(body);
		});

		req.on("error", reject);
	});
}
