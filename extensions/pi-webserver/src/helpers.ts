/**
 * HTTP helpers for mount handlers.
 *
 * Usage:
 *   import { readBody, json, html, notFound } from "pi-webserver/src/helpers.ts";
 */

import * as http from "node:http";

/** Read the full request body as a string. */
export function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

/** Send a JSON response. */
export function json(res: http.ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

/** Send an HTML response. */
export function html(res: http.ServerResponse, content: string, status: number = 200): void {
	res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
	res.end(content);
}

/** Send a CSV response with download header. */
export function csv(res: http.ServerResponse, content: string, filename: string): void {
	res.writeHead(200, {
		"Content-Type": "text/csv; charset=utf-8",
		"Content-Disposition": `attachment; filename="${filename}"`,
	});
	res.end(content);
}

/** 404 JSON response. */
export function notFound(res: http.ServerResponse, message?: string): void {
	json(res, 404, { error: message ?? "Not found" });
}

/** 400 JSON response. */
export function badRequest(res: http.ServerResponse, message?: string): void {
	json(res, 400, { error: message ?? "Bad request" });
}

/** 500 JSON response. */
export function serverError(res: http.ServerResponse, message?: string): void {
	json(res, 500, { error: message ?? "Internal server error" });
}
