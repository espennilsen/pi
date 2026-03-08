/**
 * pi-a2a — Standalone HTTP server.
 *
 * Self-contained A2A protocol server using @a2a-js/sdk for protocol handling.
 * The SDK's JsonRpcTransportHandler handles JSON-RPC routing and validation;
 * this module handles the HTTP layer, auth, and CORS.
 *
 * Routes:
 *   GET  /.well-known/agent-card.json   — A2A Agent Card (canonical SDK path)
 *   GET  /.well-known/agent.json        — A2A Agent Card (alternate path)
 *   POST /                              — A2A JSON-RPC 2.0 endpoint (streaming returns SSE)
 *   GET  /health                        — Health check
 */

import * as http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AgentCard } from "@a2a-js/sdk";
import type { JsonRpcTransportHandler } from "@a2a-js/sdk/server";
import type { LogFn } from "./logger.ts";
import { toSpecCard } from "./agent-card.ts";

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
		// Only allow CORS on localhost; external bindings should use a reverse proxy for cross-origin access
		const corsOrigin = isLocalhost ? "*" : "";
		const corsHeaders = opts.apiKey ? "Content-Type, Authorization" : "Content-Type";

		server = http.createServer(async (req, res) => {
			const method = req.method ?? "GET";
			const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
			const pathname = url.pathname;

			// CORS headers
			if (corsOrigin) {
				res.setHeader("Access-Control-Allow-Origin", corsOrigin);
				res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
				res.setHeader("Access-Control-Allow-Headers", corsHeaders);
			}

			if (method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}

			try {
				// GET /.well-known/agent.json or /.well-known/agent-card.json — Agent Card
				if ((pathname === "/.well-known/agent.json" || pathname === "/.well-known/agent-card.json") && method === "GET") {
					if (!currentAgentCard) {
						res.writeHead(503, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Agent card not yet available" }));
						return;
					}
					// Serve spec-compliant format (camelCase, §5.5) at well-known endpoint
					const specCard = toSpecCard(currentAgentCard);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(specCard, null, 2));
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
					// A2A-Version header validation (§3.6.2, §9.2)
					const clientVersion = req.headers["a2a-version"] as string | undefined;
					if (clientVersion && !clientVersion.startsWith("0.")) {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({
							jsonrpc: "2.0",
							error: { code: -32001, message: `Unsupported A2A version: ${clientVersion}. This agent supports 0.3.` },
							id: null,
						}));
						return;
					}

					// API key auth when configured
					if (opts.apiKey) {
						const authHeader = req.headers.authorization ?? "";
						const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
						if (!constantTimeEqual(token, opts.apiKey)) {
							res.writeHead(401, { "Content-Type": "application/json" });
							res.end(JSON.stringify({ error: "Unauthorized" }));
							return;
						}
					}

					const body = await readBody(req);

					let parsed: unknown;
					try {
						parsed = JSON.parse(body);
					} catch {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({
							jsonrpc: "2.0",
							error: { code: -32700, message: "Parse error" },
							id: null,
						}));
						return;
					}

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
						// Abort generator early if client disconnects to free subprocess slot
						req.on("close", () => {
							generator.return(undefined);
						});
						for await (const event of generator) {
							if (res.writableEnded) break;
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
				// Guard against writing headers twice (e.g. error during SSE streaming)
				if (res.headersSent) {
					if (!res.writableEnded) res.end();
					const msg = err instanceof Error ? err.message : String(err);
					opts.log("server_error_after_headers", { path: pathname, error: msg }, "ERROR");
					return;
				}
				if (err instanceof PayloadTooLargeError) {
					opts.log("payload_too_large", { path: pathname }, "WARN");
					res.writeHead(413, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Payload too large" }));
					return;
				}
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
		const logHost = bind === "::1" ? "[::1]" : (!bind || bind === "0.0.0.0") ? "localhost" : bind;
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
		// Destroy active connections (including SSE) so .close() callback fires promptly
		server.closeAllConnections();
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

/** Constant-time string comparison using HMAC to avoid leaking input length. */
function constantTimeEqual(a: string, b: string): boolean {
	const key = "pi-a2a-auth"; // fixed key — only used to normalize comparison
	const ha = createHmac("sha256", key).update(a).digest();
	const hb = createHmac("sha256", key).update(b).digest();
	// HMAC outputs are always 32 bytes — no length leak
	return timingSafeEqual(ha, hb);
}

class PayloadTooLargeError extends Error {
	constructor() {
		super("Payload too large");
		this.name = "PayloadTooLargeError";
	}
}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let byteLength = 0;
		let rejected = false;

		req.on("data", (chunk: Buffer) => {
			byteLength += chunk.byteLength;
			if (byteLength > MAX_BODY) {
				rejected = true;
				req.destroy();
				reject(new PayloadTooLargeError());
				return;
			}
			chunks.push(chunk);
		});

		req.on("end", () => {
			if (!rejected) resolve(Buffer.concat(chunks).toString("utf-8"));
		});

		req.on("error", reject);
	});
}
