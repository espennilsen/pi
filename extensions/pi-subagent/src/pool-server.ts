/**
 * pi-subagent — Pool IPC server.
 *
 * Lightweight HTTP server on localhost for shim ↔ pool communication.
 * Each pool agent's shim extension connects here to execute
 * spawn_agent, send_message, kill_agent, and list_agents.
 *
 * Protocol: POST to http://127.0.0.1:<port>/ with JSON body (PoolIpcRequest),
 * response is JSON (PoolIpcResponse).
 */

import * as http from "node:http";
import type { PoolIpcRequest, PoolIpcResponse } from "./types.ts";

export type PoolRequestHandler = (req: PoolIpcRequest) => Promise<PoolIpcResponse>;

export class PoolServer {
	private server: http.Server;
	private port_: number = 0;

	get port(): number { return this.port_; }

	constructor(private handler: PoolRequestHandler) {
		this.server = http.createServer(async (req, res) => {
			if (req.method !== "POST") {
				res.writeHead(405);
				res.end();
				return;
			}

			let body = "";
			req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
			req.on("end", async () => {
				let request: PoolIpcRequest;
				try {
					request = JSON.parse(body);
				} catch {
					res.writeHead(400);
					res.end(JSON.stringify({ requestId: "", success: false, error: "Invalid JSON" }));
					return;
				}

				try {
					const response = await this.handler(request);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(response));
				} catch (err: any) {
					res.writeHead(500);
					res.end(JSON.stringify({
						requestId: request.requestId,
						success: false,
						error: err?.message ?? "Internal error",
					}));
				}
			});
		});
	}

	/** Start listening on a random port. Returns the port. */
	async start(): Promise<number> {
		return new Promise((resolve, reject) => {
			this.server.listen(0, "127.0.0.1", () => {
				const addr = this.server.address();
				if (addr && typeof addr === "object") {
					this.port_ = addr.port;
					resolve(this.port_);
				} else {
					reject(new Error("Failed to get server address"));
				}
			});
			this.server.on("error", reject);
		});
	}

	/** Shut down the server. */
	dispose(): void {
		this.server.close();
	}
}
