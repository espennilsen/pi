import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CHANNEL = "dashboard";

export function createLogger(pi: ExtensionAPI) {
	return (event: string, data: unknown, level = "INFO") =>
		pi.events.emit("log", { channel: CHANNEL, event, level, data });
}
