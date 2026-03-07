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

		server = http.createServer(async (req, res) => {
			const method = req.method ?? "GET";
			const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
			const pathname = url.pathname;

			// CORS headers for browser-based A2A clients
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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

		server.listen(opts.port, () => {
			opts.log("server_started", { port: opts.port, agentCard: `http://localhost:${opts.port}/.well-known/agent.json` });
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
