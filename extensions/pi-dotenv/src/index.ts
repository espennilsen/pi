/**
 * pi-dotenv — Loads .env files into process.env.
 *
 * On session_start, reads .env files from two locations and injects them
 * into process.env so other extensions can use env-based config
 * (e.g. pi-channels "env:VAR" syntax, pi-vault OBSIDIAN_API_KEY, pi-webserver
 * API_TOKEN, etc.).
 *
 * Load order (later files override earlier):
 *   1. ~/.pi/agent/.env
 *   2. ~/.pi/agent/.env.local
 *   3. <project>/.pi/.env
 *   4. <project>/.pi/.env.local
 *
 * Project-level files override global ones. Existing process.env values
 * are never overwritten (system env wins).
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as dotenv from "dotenv";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

const ENV_FILES = [".env", ".env.local"];

function parseEnvFromDir(dir: string, ui?: { notify(msg: string, level?: "info" | "warning" | "error"): void }): Record<string, string> {
	const vars: Record<string, string> = {};

	for (const file of ENV_FILES) {
		const filePath = path.join(dir, file);
		if (!fs.existsSync(filePath)) continue;

		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const parsed = dotenv.parse(content);
			// Later files override earlier ones within the same directory
			Object.assign(vars, parsed);
		} catch (err: any) {
			ui?.notify(`pi-dotenv: failed to parse ${filePath}: ${err.message}`, "warning");
		}
	}

	return vars;
}

function loadEnv(cwd: string, ui?: { notify(msg: string, level?: "info" | "warning" | "error"): void }): void {
	const agentDir = getAgentDir();
	const projectDir = path.join(cwd, ".pi");

	// Parse global first, then project overrides global
	const vars = parseEnvFromDir(agentDir, ui);
	if (projectDir !== agentDir) {
		Object.assign(vars, parseEnvFromDir(projectDir, ui));
	}

	// Inject into process.env — system/shell env always wins
	let loaded = 0;
	for (const [key, value] of Object.entries(vars)) {
		if (process.env[key] === undefined) {
			process.env[key] = value;
			loaded++;
		}
	}

	if (loaded > 0) {
		ui?.notify(`pi-dotenv: loaded ${loaded} variable${loaded !== 1 ? "s" : ""}`, "info");
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		loadEnv(ctx.cwd, ctx.ui);
	});
}
