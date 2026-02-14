import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type LogFn = (event: string, data: unknown, level?: string) => void;

export function createLogger(pi: ExtensionAPI): LogFn {
	return (event: string, data: unknown, level: string = "INFO") => {
		pi.events.emit("log:write", {
			source: "pi-github",
			event,
			data,
			level,
		});
	};
}
