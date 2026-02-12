/**
 * pi-memory — Persistent memory extension for pi.
 *
 * Provides:
 *   - memory_read   — Read MEMORY.md or daily logs
 *   - memory_write  — Append to daily log or update long-term memory
 *   - memory_search — Full-text search across all memory files
 *   - System prompt injection of MEMORY.md + recent daily logs
 *
 * Memory is stored as plain Markdown files:
 *   MEMORY.md            — Curated long-term memory (preferences, decisions, facts)
 *   memory/YYYY-MM-DD.md — Daily append-only logs (session notes, context)
 *
 * Configuration (settings.json under "pi-memory"):
 *   { "pi-memory": { "path": "~/notes/memory" } }
 *
 * Defaults to cwd if no path is configured.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setBasePath } from "./files.ts";
import { registerMemoryTools } from "./tools.ts";
import { registerMemoryContext } from "./context.ts";
import { resolveSettings } from "./settings.ts";
import { createLogger } from "./logger.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	// Register tools and context injection immediately
	registerMemoryTools(pi);
	registerMemoryContext(pi);

	// Resolve base path from settings on session start
	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);
		const basePath = settings.path ?? ctx.cwd;
		setBasePath(basePath);
		log("init", { basePath });
	});
}
