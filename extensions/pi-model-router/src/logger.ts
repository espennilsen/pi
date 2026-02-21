/**
 * pi-model-router — Extension logger.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function createLogger(pi: ExtensionAPI) {
	return (event: string, data: unknown, level: string = "INFO") => {
		pi.events.emit("log", {
			source: "pi-model-router",
			event,
			data,
			level,
		});
	};
}
