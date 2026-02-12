/**
 * pi-webnav — Unified navigation shell for pi-webserver.
 *
 * Mounts at "/" to replace the default dashboard with a persistent
 * top nav bar + iframe layout. Each registered mount becomes a nav
 * button; clicking it loads the mount's page in the iframe below.
 *
 * Features:
 *   - Discovers mounts from pi-webserver's /_api/mounts/dashboard
 *   - Hash-based routing for bookmarkable deep links
 *   - Active nav button highlights based on current iframe path
 *   - Home view shows mount cards (like the original dashboard)
 *   - Periodically refreshes mount list for runtime changes
 *   - Falls back gracefully — each mount still works standalone
 *
 * Requires pi-webserver >= 0.1.0 with root mount override support.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";

const NAV_HTML = fs.readFileSync(
	path.resolve(import.meta.dirname, "../nav.html"),
	"utf-8",
);

interface MountConfig {
	name: string;
	label?: string;
	description?: string;
	prefix: string;
	handler: (
		req: import("node:http").IncomingMessage,
		res: import("node:http").ServerResponse,
		subPath: string,
	) => void | Promise<void>;
}

function mountNav(pi: ExtensionAPI): void {
	const config: MountConfig = {
		name: "webnav",
		label: "Navigation",
		description: "Unified navigation shell",
		prefix: "/",
		handler: (_req, res, subPath) => {
			// Only serve the nav shell at the root
			if (subPath === "/" || subPath === "") {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(NAV_HTML);
				return;
			}
			// Anything else under "/" that doesn't match a more specific
			// mount will 404 (pi-webserver's longest-prefix matching
			// ensures specific mounts like /tasks still win)
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		},
	};

	pi.events.emit("web:mount", config);
}

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	const mount = () => { mountNav(pi); log("mount", {}); };

	// Mount when pi-webserver signals ready
	pi.events.on("web:ready", mount);

	// Also mount on session start (in case web server started first)
	pi.on("session_start", async () => {
		mount();
	});

	// Cleanup
	pi.on("session_shutdown", async () => {
		pi.events.emit("web:unmount", { name: "webnav" });
	});
}
