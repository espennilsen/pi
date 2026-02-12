/**
 * Obsidian Local REST API client.
 *
 * Shared between the vault tool and health dashboard.
 *
 * Config from settings.json under "pi-vault":
 * {
 *   "pi-vault": {
 *     "vaultPath": "~/Library/CloudStorage/.../Obsidian/e9n",
 *     "vaultName": "e9n",
 *     "apiUrl": "http://127.0.0.1:27123",
 *     "apiKey": "your-obsidian-api-key"
 *   }
 * }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Types ───────────────────────────────────────────────────────

export interface VaultConfig {
	/** Absolute path to vault root on disk */
	vaultPath: string;
	/** Vault name as registered in Obsidian (for deep links) */
	vaultName: string;
	/** REST API base URL (e.g. http://127.0.0.1:27123) */
	apiUrl: string;
	/** API key for the Local REST API plugin */
	apiKey: string;
}

export interface ApiResponse {
	ok: boolean;
	status: number;
	data?: any;
	text?: string;
	error?: string;
}

// ── Config resolution ───────────────────────────────────────────

const SETTINGS_KEY = "pi-vault";

function expandHome(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

function readJsonSafe(filePath: string): Record<string, unknown> {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return {};
	}
}

/**
 * Load vault config from settings.json (global + project).
 *
 * Reads "pi-vault" key from:
 *   1. ~/.pi/agent/settings.json (global)
 *   2. .pi/settings.json (project, overrides global)
 */
export function resolveConfig(cwd: string): VaultConfig {
	const globalPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
	const projectPath = path.join(cwd, ".pi", "settings.json");

	const globalRaw = readJsonSafe(globalPath)[SETTINGS_KEY] as Record<string, unknown> | undefined;
	const projectRaw = readJsonSafe(projectPath)[SETTINGS_KEY] as Record<string, unknown> | undefined;

	// Project overrides global
	const merged = {
		...(globalRaw ?? {}),
		...(projectRaw ?? {}),
	} as Record<string, string>;

	let vaultPath = merged.vaultPath ?? "";
	if (vaultPath) vaultPath = expandHome(vaultPath);

	return {
		vaultPath,
		vaultName: merged.vaultName || (vaultPath ? path.basename(vaultPath) : ""),
		apiUrl: merged.apiUrl || "http://127.0.0.1:27123",
		apiKey: merged.apiKey || "",
	};
}

// ── API client ──────────────────────────────────────────────────

export async function apiRequest(
	config: VaultConfig,
	method: string,
	endpoint: string,
	opts?: { body?: string; contentType?: string; accept?: string; headers?: Record<string, string>; timeoutMs?: number },
): Promise<ApiResponse> {
	if (!config.apiKey) {
		return { ok: false, status: 0, error: "No API key configured (set pi-vault.apiKey in settings.json)" };
	}

	const url = `${config.apiUrl}${endpoint}`;
	const headers: Record<string, string> = {
		"Authorization": `Bearer ${config.apiKey}`,
		...(opts?.headers ?? {}),
	};
	if (opts?.contentType) headers["Content-Type"] = opts.contentType;
	if (opts?.accept) headers["Accept"] = opts.accept;

	try {
		const response = await fetch(url, {
			method,
			headers,
			body: opts?.body,
			signal: AbortSignal.timeout(opts?.timeoutMs ?? 15_000),
		});

		const contentType = response.headers.get("content-type") ?? "";
		let data: any;
		let text: string | undefined;

		if (contentType.includes("json")) {
			data = await response.json();
		} else {
			text = await response.text();
		}

		return { ok: response.ok, status: response.status, data, text, error: data?.message };
	} catch (e: any) {
		return { ok: false, status: 0, error: e.message ?? "API request failed" };
	}
}

/**
 * Check if the Obsidian REST API is reachable and authenticated.
 */
export async function isApiAvailable(config: VaultConfig): Promise<boolean> {
	if (!config.apiKey) return false;
	const res = await apiRequest(config, "GET", "/vault/");
	return res.ok;
}

// ── Helpers ─────────────────────────────────────────────────────

export function encodePath(vaultRelPath: string): string {
	return vaultRelPath.split("/").map(encodeURIComponent).join("/");
}
