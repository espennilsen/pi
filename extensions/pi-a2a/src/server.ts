/**
 * pi-a2a — Standalone HTTP server.
 *
 * Self-contained A2A protocol server using @a2a-js/sdk for protocol handling.
 * The SDK's JsonRpcTransportHandler handles JSON-RPC routing and validation;
 * this module handles the HTTP layer, auth, and CORS.
 *
 * Routes:
 *   GET  /.well-known/agent.json       — A2A Agent Card
 *   GET  /.well-known/agent-card.json   — A2A Agent Card (SDK convention)
 *   POST /                              — A2A JSON-RPC 2.0 endpoint
 *   GET  /health                        — Health check
 */

import * as http from "node:http";
import type { AgentCard } from "@a2a-js/sdk";
import type { JsonRpcTransportHandler } from "@a2a-js/sdk/server";
import type { LogFn } from "./logger.ts";

const MAX_BODY = 1_048_576; // 1 MB

export interface ServerOptions {
	port: number;
	/** Bind address. Defaults to "127.0.0.1" (localhost only). */
	bind?: string;
	/** API key for authenticating RPC requests. */
	apiKey?: string;
	agentCard: AgentCard;
	/** SDK JSON-RPC transport handler for A2A protocol dispatch. */
	rpcHandler: JsonRpcTransportHandler;
	log: LogFn;
}

let server: http.Server | null = null;
let currentAgentCard: AgentCard | null = null;

export function startServer(opts: ServerOptions): Promise<void> {
	return new Promise((resolve, reject) => {
		if (server) {
			opts.log("server_already_running", { port: opts.port }, "WARN");
			resolve();
			return;
		}

		currentAgentCard = opts.agentCard;

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
				// GET /.well-known/agent.json or /.well-known/agent-card.json — Agent Card
				if ((pathname === "/.well-known/agent.json" || pathname === "/.well-known/agent-card.json") && method === "GET") {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(currentAgentCard, null, 2));
					return;
				}

				// GET /health — Health check
				if (pathname === "/health" && method === "GET") {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ status: "healthy", agent: currentAgentCard?.name }));
					return;
				}

				// POST / — A2A JSON-RPC 2.0 (via SDK handler)
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
					const parsed = JSON.parse(body);
					const result = await opts.rpcHandler.handle(parsed);

					// Check if result is an async generator (streaming)
					if (result && typeof result === "object" && Symbol.asyncIterator in result) {
						// SSE streaming response
						res.writeHead(200, {
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache",
							"Connection": "keep-alive",
						});
						const generator = result as AsyncGenerator<unknown>;
						for await (const event of generator) {
							res.write(`data: ${JSON.stringify(event)}\n\n`);
						}
						res.end();
					} else {
						// Single JSON-RPC response
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify(result));
					}
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
			currentAgentCard = null;
			resolve();
		});
	});
}

export function isRunning(): boolean {
	return server !== null;
}

/**
 * Update the agent card served by the running server.
 */
export function updateAgentCard(card: AgentCard): void {
	currentAgentCard = card;
}

/**
 * Get the current agent card, or null if server hasn't started.
 */
export function getAgentCard(): AgentCard | null {
	return currentAgentCard;
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
