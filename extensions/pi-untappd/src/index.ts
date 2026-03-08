/**
 * pi-untappd — Untappd venue, user, and brewery monitoring extension.
 *
 * Provides:
 *   - Manual HTML scraping of venues, breweries, and users
 *   - Automated RSS polling for check-ins and activity
 *   - Normalized beer database with venue-specific prices
 *   - Web UI for managing sources and viewing data
 *   - JSON API under /api/untappd/ for integrations
 *
 * Integration:
 *   - pi-kysely: database schema via event bus (no direct imports)
 *   - pi-webserver: web UI and JSON API routes
 *   - pi-cron: scheduled RSS polling (configured via crontab, see README)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { initDb } from "./db/init.ts";
import { mountWebRoutes, unmountWebRoutes } from "./web/index.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Initialize database schema via pi-kysely event bus
		await initDb(pi.events, log);

		// Mount web routes when webserver is ready
		const mountWeb = () => {
			mountWebRoutes(pi.events, log);
		};

		// Try mounting immediately if webserver is already running
		mountWeb();

		// Re-mount when webserver restarts
		pi.events.on("web:ready", () => {
			unmountWebRoutes(pi.events);
			mountWebRoutes(pi.events, log);
		});

		log("ready", { cwd: ctx.cwd });
	});

	pi.on("session_shutdown", async () => {
		unmountWebRoutes(pi.events);
		log("shutdown", {});
	});
}
