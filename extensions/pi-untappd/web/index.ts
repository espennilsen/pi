/**
 * Web interface and API for pi-untappd.
 */

import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { LogFn } from "../logger.ts";
import * as http from "node:http";

type RouteHandler = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
	path: string
) => void | Promise<void>;

let mounted = false;

export function mountWebRoutes(events: EventBus, log: LogFn): void {
	if (mounted) return;
	mounted = true;

	log("web_mount", {});

	// Mount UI routes
	events.emit("web:mount", {
		name: "untappd-ui",
		label: "Untappd",
		description: "Beer tracking and monitoring",
		prefix: "/untappd",
		handler: createUIHandler(log),
	});

	// Mount API routes
	events.emit("web:mount-api", {
		name: "untappd-api",
		label: "Untappd API",
		description: "JSON API for Untappd data",
		prefix: "/api/untappd",
		handler: createAPIHandler(log),
	});
}

export function unmountWebRoutes(events: EventBus): void {
	if (!mounted) return;
	mounted = false;

	events.emit("web:unmount", { name: "untappd-ui" });
	events.emit("web:unmount-api", { name: "untappd-api" });
}

function createUIHandler(log: LogFn): RouteHandler {
	return async (req, res, path) => {
		try {
			const { handleUIRequest } = await import("./ui.ts");
			await handleUIRequest(req, res, path, log);
		} catch (err: any) {
			log("ui_error", { path, error: err.message }, "error");
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	};
}

function createAPIHandler(log: LogFn): RouteHandler {
	return async (req, res, path) => {
		try {
			const { handleAPIRequest } = await import("./api.ts");
			await handleAPIRequest(req, res, path, log);
		} catch (err: any) {
			log("api_error", { path, error: err.message }, "error");
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Internal Server Error" }));
		}
	};
}
