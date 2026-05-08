/**
 * pi-supabase — Logger via pi-logger event bus.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type LogFn = (event: string, data: unknown, level?: string) => void;

export function createLogger(pi: ExtensionAPI): LogFn {
	return (event: string, data: unknown, level: string = "INFO") => {
		pi.events.emit("log:write", {
			source: "pi-supabase",
			event,
			data,
			level,
		});
	};
}
