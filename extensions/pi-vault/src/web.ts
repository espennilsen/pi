/**
 * Vault web routes — mounts on pi-webserver.
 *
 * Web page:  /vault       — Vault health dashboard
 * API:       /api/vault/* — Health data endpoint
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { VaultConfig } from "./api-client.ts";
import { getVaultHealthData } from "./health.ts";

// ── HTTP helpers (inline to avoid import dependency on pi-webserver) ──

function json(res: ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function html(res: ServerResponse, content: string, status: number = 200): void {
	res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
	res.end(content);
}

// ── Types for pi-webserver mount protocol ───────────────────────

type RouteHandler = (
	req: IncomingMessage,
	res: ServerResponse,
	subPath: string,
) => void | Promise<void>;

interface MountConfig {
	name: string;
	label?: string;
	description?: string;
	prefix: string;
	handler: RouteHandler;
}

// ── Load HTML once ──────────────────────────────────────────────

const VAULT_HTML = fs.readFileSync(
	path.resolve(import.meta.dirname, "./vault.html"),
	"utf-8",
);

// ── Route mounting ──────────────────────────────────────────────

export function mountVaultRoutes(pi: ExtensionAPI, config: VaultConfig): void {
	// Web page mount: GET /vault
	const webMount: MountConfig = {
		name: "vault",
		label: "Vault",
		description: "Obsidian vault health dashboard",
		prefix: "/vault",
		handler: (req, res, subPath) => {
			if (req.method !== "GET") {
				json(res, 405, { error: "Method not allowed" });
				return;
			}
			const pathKey = subPath === "/" || subPath === "" ? "/" : subPath;
			if (pathKey === "/") {
				html(res, VAULT_HTML);
				return;
			}
			json(res, 404, { error: "Not found" });
		},
	};

	// API mount: GET /api/vault/health
	const apiMount: MountConfig = {
		name: "vault-api",
		label: "Vault API",
		description: "Vault health data",
		prefix: "/vault",
		handler: async (req, res, subPath) => {
			if (req.method !== "GET") {
				json(res, 405, { error: "Method not allowed" });
				return;
			}
			const pathKey = subPath.replace(/\/+$/, "") || "/";
			if (pathKey === "/health") {
				try {
					const data = await getVaultHealthData(config);
					json(res, 200, data);
				} catch (e: any) {
					json(res, 500, { error: e.message });
				}
				return;
			}
			json(res, 404, { error: "Not found" });
		},
	};

	pi.events.emit("web:mount", webMount);
	pi.events.emit("web:mount-api", apiMount);
}

export function unmountVaultRoutes(pi: ExtensionAPI): void {
	pi.events.emit("web:unmount", { name: "vault" });
	pi.events.emit("web:unmount-api", { name: "vault-api" });
}
