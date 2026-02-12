import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CHANNEL = "heartbeat";

export function createLogger(pi: ExtensionAPI) {
	return (event: string, data: unknown, level = "INFO") =>
		pi.events.emit("log", { channel: CHANNEL, event, level, data });
}
