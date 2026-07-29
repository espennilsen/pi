import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type LogFn = (event: string, data: unknown, level?: string) => void;

export function createLogger(pi: ExtensionAPI): LogFn {
	return (event: string, data: unknown, level: string = "info") => {
		pi.events.emit("log:extension", {
			extension: "pi-untappd",
			event,
			data,
			level,
		});
	};
}
