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
import { Extensions, HTTP_EXTENSION_HEADER, type AgentCard } from "@a2a-js/sdk";
import { ServerCallContext, type JsonRpcTransportHandler, type User } from "@a2a-js/sdk/server";
import type { LogFn } from "./logger.ts";
import { authenticateInboundRequest, getInboundSupportedModes, type MtlsEvidence, type OAuthVerifier } from "./inbound-auth.ts";
import type { AuthMode, LocalAuthOverride } from "./auth-types.ts";

/** Authenticated user — created when API key auth succeeds. */
class AuthenticatedUser implements User {
	private _userName: string;

	constructor(userName: string) {
		this._userName = userName;
	}

	get isAuthenticated(): boolean { return true; }
	get userName(): string { return this._userName; }
}

const MAX_BODY = 1_048_576; // 1 MB

export interface ServerOptions {
	port: number;
	/** Bind address. Defaults to "127.0.0.1" (localhost only). */
	bind?: string;
	/** API key for authenticating RPC requests. */
	apiKey?: string;
	/** Additive inbound auth policy. Omitted preserves legacy API-key behavior. */
	auth?: LocalAuthOverride;
	/** Runtime-enforceable modes (mTLS is omitted for this HTTP server). */
	supportedAuthModes?: AuthMode[];
	/** Injected verifier; without one OAuth requests fail closed. */
	verifyOAuth?: OAuthVerifier;
	/** TLS peer evidence, for an HTTPS server integration. Forwarded headers are never trusted. */
	getMtlsEvidence?: (req: http.IncomingMessage) => MtlsEvidence | undefined;
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
		const corsHeaders = (opts.apiKey || opts.auth?.supportedAuthModes?.some((mode) => mode !== "legacy-api-key")) ? "Content-Type, Authorization" : "Content-Type";
		const supportedAuthModes = opts.supportedAuthModes ?? getInboundSupportedModes({ apiKey: opts.apiKey, auth: opts.auth });
		const authenticationRequired = supportedAuthModes.length > 0;

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
					// A2A-Version header validation (§3.6.2, §9.2)
					const clientVersion = req.headers["a2a-version"] as string | undefined;
					if (clientVersion && !clientVersion.startsWith("0.")) {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({
							jsonrpc: "2.0",
							error: { code: -32600, message: `Unsupported A2A version: ${clientVersion}. This agent supports 0.x.` },
							id: null,
						}));
						return;
					}
					if (clientVersion && !(clientVersion === "0.3" || clientVersion.startsWith("0.3."))) {
						opts.log("a2a_version_mismatch", { clientVersion, supported: "0.3.x" }, "WARN");
					}

					const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
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

					// Authenticate once after extracting the operation, still before dispatch.
					// This avoids verifying an OAuth bearer token twice per request.
					const operation = operationFromRpc(parsed);
					const taskId = rpcTaskId(parsed);
					const authentication = authenticationRequired ? await authenticateInboundRequest({
						authorization: authHeader, local: { apiKey: opts.apiKey, auth: opts.auth },
						supportedModes: supportedAuthModes, verifyOAuth: opts.verifyOAuth,
						mtlsEvidence: opts.getMtlsEvidence?.(req), operation, taskId,
						requireTaskBinding: supportedAuthModes.some((mode) => mode === "oauth2" || mode === "oauth2+mtls"),
						requestedSkill: skillFromRpc(parsed),
						...(supportedAuthModes.some((mode) => mode === "oauth2" || mode === "oauth2+mtls") ? { requiredOAuthScope: "tasks:run" } : {}),
					}) : {};
					if (authenticationRequired && !authentication.principal) {
						opts.log("a2a_auth_policy_denied", { peerId: "unknown", taskId: rpcTaskId(parsed), operation: operation ?? "unknown", metadataSource: "inbound", mode: "unknown", reason: authentication.reason }, "WARN");
						res.writeHead(authentication.status ?? 403, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Forbidden" }));
						return;
					}
					if (authenticationRequired && authentication.principal) {
						opts.log("a2a_auth_inbound_allowed", { peerId: authentication.principal.identity, taskId: rpcTaskId(parsed), operation: operation ?? "unknown", metadataSource: "inbound", mode: authentication.principal.mode });
					}

					// Build ServerCallContext with extensions and auth info.
					// The SDK threads this through to RequestContext.context
					// so the executor can inspect caller identity and extensions.
					const extensionsHeader = req.headers[HTTP_EXTENSION_HEADER.toLowerCase()] as string | undefined;
					let requestedExtensions: string[] = [];
					try {
						requestedExtensions = Extensions.parseServiceParameter(extensionsHeader);
					} catch (err) {
						opts.log("extensions_parse_error", { header: extensionsHeader, error: err instanceof Error ? err.message : String(err) }, "WARN");
					}
					const user: User | undefined = authentication.principal ? new AuthenticatedUser(authentication.principal.identity) : undefined;
					const callContext = new ServerCallContext(
						requestedExtensions.length > 0 ? requestedExtensions : undefined,
						user,
					);

					const result = await opts.rpcHandler.handle(parsed, callContext);

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


class PayloadTooLargeError extends Error {
	constructor() {
		super("Payload too large");
		this.name = "PayloadTooLargeError";
	}
}

/** Prefer an explicit A2A skill identifier when supplied; otherwise policy applies to the RPC method. */
function operationFromRpc(value: unknown): string | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const rpc = value as { method?: unknown; params?: { skillId?: unknown; skill?: unknown } };
	if (typeof rpc.params?.skillId === "string") return rpc.params.skillId;
	if (typeof rpc.params?.skill === "string") return rpc.params.skill;
	return typeof rpc.method === "string" ? rpc.method : undefined;
}

function skillFromRpc(value: unknown): string | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const params = (value as { params?: unknown }).params;
	if (params === null || typeof params !== "object" || Array.isArray(params)) return undefined;
	const candidate = params as { skillId?: unknown; skill?: unknown };
	return typeof candidate.skillId === "string" ? candidate.skillId : typeof candidate.skill === "string" ? candidate.skill : undefined;
}

function rpcTaskId(value: unknown): string | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const params = (value as { params?: unknown }).params;
	if (params === null || typeof params !== "object" || Array.isArray(params)) return undefined;
	const candidate = params as { taskId?: unknown; id?: unknown; message?: { taskId?: unknown } };
	const taskId = candidate.taskId ?? candidate.id ?? candidate.message?.taskId;
	return typeof taskId === "string" ? taskId : undefined;
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
