/**
 * pi-a2a — Structured logger via pi-logger event bus.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogFn = (action: string, detail?: Record<string, unknown>, level?: LogLevel) => void;

export function createLogger(pi: ExtensionAPI): LogFn {
	return (action: string, detail?: Record<string, unknown>, level: LogLevel = "INFO") => {
		pi.events.emit("log", {
			source: "pi-a2a",
			level,
			action,
			detail: detail ?? {},
			ts: new Date().toISOString(),
		});
	};
}
