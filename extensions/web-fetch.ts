/**
 * Web Fetch Tool - Fetches content from URLs
 *
 * Provides the LLM with a tool to fetch web pages and API responses.
 * Output is truncated to avoid overwhelming the context window.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FetchParams = Type.Object({
	url: Type.String({ description: "URL to fetch" }),
	method: Type.Optional(StringEnum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const, { description: "HTTP method (default: GET)" })),
	headers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "HTTP headers as key-value pairs" })),
	body: Type.Optional(Type.String({ description: "Request body (for POST, PUT, PATCH)" })),
});

interface FetchDetails {
	url: string;
	method: string;
	status?: number;
	statusText?: string;
	contentType?: string;
	truncated?: boolean;
	fullOutputPath?: string;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: `Fetch content from a URL. Supports HTTP methods, custom headers, and request bodies. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. If truncated, full output is saved to a temp file. Use this for fetching web pages, APIs, documentation, etc.`,
		parameters: FetchParams,

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const { url, method = "GET", headers, body } = params;

			const details: FetchDetails = { url, method };

			try {
				const response = await fetch(url, {
					method,
					headers: headers ? new Headers(headers) : undefined,
					body: body && ["POST", "PUT", "PATCH"].includes(method) ? body : undefined,
					signal,
					redirect: "follow",
				});

				details.status = response.status;
				details.statusText = response.statusText;
				details.contentType = response.headers.get("content-type") ?? undefined;

				const text = await response.text();

				// Apply truncation
				const truncation = truncateHead(text, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let resultText = "";

				// Add response info header
				resultText += `HTTP ${response.status} ${response.statusText}\n`;
				resultText += `Content-Type: ${details.contentType ?? "unknown"}\n\n`;
				resultText += truncation.content;

				if (truncation.truncated) {
					const tempDir = mkdtempSync(join(tmpdir(), "pi-fetch-"));
					const tempFile = join(tempDir, "response.txt");
					writeFileSync(tempFile, text);

					details.truncated = true;
					details.fullOutputPath = tempFile;

					resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
					resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
					resultText += ` Full output saved to: ${tempFile}]`;
				}

				return {
					content: [{ type: "text", text: resultText }],
					details,
					isError: response.status >= 400,
				};
			} catch (err: any) {
				if (signal?.aborted) {
					return {
						content: [{ type: "text", text: "Request cancelled" }],
						details,
						isError: true,
					};
				}

				return {
					content: [{ type: "text", text: `Fetch failed: ${err.message}` }],
					details,
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("web_fetch "));
			if (args.method && args.method !== "GET") {
				text += theme.fg("accent", args.method + " ");
			}
			text += theme.fg("muted", args.url);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as FetchDetails | undefined;

			if (isPartial) {
				return new Text(theme.fg("warning", "Fetching..."), 0, 0);
			}

			if (!details?.status) {
				const content = result.content[0];
				const msg = content?.type === "text" ? content.text : "Request failed";
				return new Text(theme.fg("error", msg), 0, 0);
			}

			const statusColor = details.status < 400 ? "success" : "error";
			let text = theme.fg(statusColor, `${details.status} ${details.statusText}`);
			if (details.contentType) {
				text += theme.fg("dim", ` (${details.contentType})`);
			}
			if (details.truncated) {
				text += theme.fg("warning", " [truncated]");
			}

			if (expanded) {
				const content = result.content[0];
				if (content?.type === "text") {
					const lines = content.text.split("\n").slice(0, 30);
					for (const line of lines) {
						text += `\n${theme.fg("dim", line)}`;
					}
					if (content.text.split("\n").length > 30) {
						text += `\n${theme.fg("muted", "...")}`;
					}
				}
				if (details.fullOutputPath) {
					text += `\n${theme.fg("dim", `Full output: ${details.fullOutputPath}`)}`;
				}
			}

			return new Text(text, 0, 0);
		},
	});
}
