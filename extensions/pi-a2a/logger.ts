/**
 * pi-a2a — Structured logger via pi-logger event bus.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogFn = (action: string, detail?: Record<string, unknown>, level?: LogLevel) => void;

/** Replace credential material before it reaches any log transport. */
export function redactLogDetail(detail: Record<string, unknown>): Record<string, unknown> {
	return redactValue(detail) as Record<string, unknown>;
}

const SECRET_FIELD = /(?:api[_-]?key|credential|authorization|token|secret|private[_-]?key|(?:certificate|cert|key)(?:[_-]?(?:content|data|pem))?)$/i;
const PEM_CONTENT = /-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----/;

function redactValue(value: unknown, fieldName?: string): unknown {
	if (fieldName && SECRET_FIELD.test(fieldName)) return "[REDACTED]";
	if (typeof value === "string") return PEM_CONTENT.test(value) ? "[REDACTED]" : value;
	if (Array.isArray(value)) return value.map((item) => redactValue(item));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, key)]));
	}
	return value;
}

export function createLogger(pi: ExtensionAPI): LogFn {
	return (action: string, detail?: Record<string, unknown>, level: LogLevel = "INFO") => {
		pi.events.emit("log", {
			source: "pi-a2a",
			level,
			action,
			detail: redactLogDetail(detail ?? {}),
			ts: new Date().toISOString(),
		});
	};
}
