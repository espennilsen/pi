/**
 * pi-dotenv — Loads .env files from the pi agent home directory into process.env.
 *
 * On session_start, reads .env files from ~/.pi/agent/ (or $PI_CODING_AGENT_DIR)
 * and injects them into process.env so other extensions can use env-based config
 * (e.g. pi-channels "env:VAR" syntax, pi-vault OBSIDIAN_API_KEY, pi-webserver
 * API_TOKEN, etc.).
 *
 * Load order (later files override earlier):
 *   1. .env
 *   2. .env.local
 *
 * Existing process.env values are never overwritten (system env wins).
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as dotenv from "dotenv";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

const ENV_FILES = [".env", ".env.local"];

function loadEnv(ui?: { notify(msg: string, level: string): void }): void {
	const agentDir = getAgentDir();
	let loaded = 0;

	for (const file of ENV_FILES) {
		const filePath = path.join(agentDir, file);
		if (!fs.existsSync(filePath)) continue;

		const result = dotenv.config({ path: filePath, override: false });
		if (result.error) {
			ui?.notify(`pi-dotenv: failed to parse ${file}: ${result.error.message}`, "warn");
			continue;
		}

		const count = result.parsed ? Object.keys(result.parsed).length : 0;
		loaded += count;
	}

	if (loaded > 0) {
		ui?.notify(`pi-dotenv: loaded ${loaded} variable${loaded !== 1 ? "s" : ""} from ${agentDir}`, "info");
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		loadEnv(ctx.ui);
	});
}
